import 'dart:convert';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/app_state.dart';
import '../../ui/motion.dart';
import '../../ui/widgets.dart';

/// Guided selfie for KYC tier 2. The photo is checked on the server (liveness, then a
/// match against the BVN photo) — nothing on the phone decides the result. Only the
/// front camera is used; gallery photos are never accepted.
class SelfieScreen extends StatefulWidget {
  const SelfieScreen({super.key, this.cameraFactory});

  /// For tests: skip the real camera.
  final Future<CameraController?> Function()? cameraFactory;
  @override
  State<SelfieScreen> createState() => _SelfieScreenState();
}

enum _Step { tips, bvn, camera, review, result }

class _SelfieScreenState extends State<SelfieScreen> with WidgetsBindingObserver {
  _Step _step = _Step.tips;
  final _bvn = TextEditingController();
  CameraController? _cam;
  bool _camFailed = false;
  Uint8List? _photo;
  bool _busy = false;
  Map<String, dynamic>? _result;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cam?.dispose();
    _bvn.dispose();
    super.dispose();
  }

  // Release the camera when the app goes to the background; reopen on return.
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (_step != _Step.camera) return;
    if (s == AppLifecycleState.inactive || s == AppLifecycleState.paused) {
      _cam?.dispose();
      _cam = null;
    } else if (s == AppLifecycleState.resumed) {
      _openCamera();
    }
  }

  Future<void> _openCamera() async {
    setState(() => _camFailed = false);
    try {
      CameraController? c;
      if (widget.cameraFactory != null) {
        c = await widget.cameraFactory!();
      } else {
        final cams = await availableCameras();
        final front = cams.where((x) => x.lensDirection == CameraLensDirection.front).toList();
        if (front.isEmpty) throw StateError('no front camera');
        c = CameraController(front.first, ResolutionPreset.medium, enableAudio: false, imageFormatGroup: ImageFormatGroup.jpeg);
        await c.initialize();
      }
      if (!mounted) {
        await c?.dispose();
        return;
      }
      setState(() => _cam = c);
      if (c == null) setState(() => _camFailed = true);
    } catch (_) {
      if (mounted) setState(() => _camFailed = true);
    }
  }

  Future<void> _capture() async {
    try {
      Uint8List? bytes;
      if (_cam != null && _cam!.value.isInitialized) {
        final shot = await _cam!.takePicture();
        bytes = await shot.readAsBytes();
      } else {
        // Fallback: the system camera, front lens, never the gallery.
        final shot = await ImagePicker().pickImage(source: ImageSource.camera, preferredCameraDevice: CameraDevice.front, maxWidth: 1080, imageQuality: 85);
        bytes = await shot?.readAsBytes();
      }
      if (bytes == null || !mounted) return;
      HapticFeedback.lightImpact();
      setState(() {
        _photo = bytes;
        _step = _Step.review;
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      final r = await AppScope.read(context).api.post('/v1/kyc/selfie', {'bvn': _bvn.text, 'image': base64Encode(_photo!)});
      if (!mounted) return;
      if (r['status'] == 'passed') HapticFeedback.mediumImpact();
      setState(() {
        _result = r;
        _step = _Step.result;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'bvn_mismatch') {
        setState(() => _step = _Step.bvn);
      }
      showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _go(_Step s) {
    setState(() => _step = s);
    if (s == _Step.camera && _cam == null) _openCamera();
  }

  Widget _tips(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    Widget tip(IconData i, String t) => ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: cs.primary.withValues(alpha: 0.12),
        child: Icon(i, color: cs.primary),
      ),
      title: Text(t),
    );
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        FadeSlideIn(child: Text('Take a quick selfie', style: Theme.of(context).textTheme.headlineSmall)),
        const SizedBox(height: 8),
        FadeSlideIn(
          delay: const Duration(milliseconds: 60),
          child: Text('We check it is really you and compare it with the photo on your BVN record. It takes under a minute.', style: TextStyle(color: cs.onSurfaceVariant)),
        ),
        const SizedBox(height: 16),
        for (final (i, t) in [
          (Icons.wb_sunny_outlined, 'Face a light source; avoid bright light behind you'),
          (Icons.face_retouching_off_outlined, 'Remove glasses, hats and face coverings'),
          (Icons.crop_free, 'Fill the oval with your face and look straight ahead'),
          (Icons.person_outline, 'Only you in the photo, taken now (not a photo of a photo)'),
        ].indexed)
          FadeSlideIn(
            delay: Duration(milliseconds: 100 + 60 * i),
            child: tip(t.$1, t.$2),
          ),
        const SizedBox(height: 16),
        Text('Your photo is encrypted and only used for verification.', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
        const SizedBox(height: 16),
        FilledButton(onPressed: () => _go(_Step.bvn), child: const Text('Continue')),
      ],
    );
  }

  Widget _bvnStep(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Text('Confirm your BVN', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 6),
      Text("We don't store your full BVN, so we need it once more to fetch your BVN photo.", style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      const SizedBox(height: 16),
      TextField(
        controller: _bvn,
        autofocus: true,
        keyboardType: TextInputType.number,
        maxLength: 11,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: const InputDecoration(labelText: 'BVN', counterText: ''),
      ),
      const SizedBox(height: 20),
      FilledButton(onPressed: () => _bvn.text.length == 11 ? _go(_Step.camera) : showInfo(context, 'Enter your 11-digit BVN'), child: const Text('Open camera')),
    ],
  );

  Widget _cameraStep(BuildContext context) {
    final ready = _cam != null && _cam!.value.isInitialized;
    return Stack(
      fit: StackFit.expand,
      children: [
        Container(color: Colors.black),
        if (ready) Center(child: CameraPreview(_cam!)),
        // Dim everything outside the oval, with a breathing outline to guide the user.
        const _OvalMask(),
        Positioned(
          left: 24,
          right: 24,
          top: 24,
          child: Text(
            _camFailed
                ? "Can't open the camera here. Tap the button to use your phone's camera instead."
                : ready
                ? 'Fit your face in the oval and look straight ahead'
                : 'Opening camera…',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600, shadows: [Shadow(blurRadius: 8)]),
          ),
        ),
        if (_camFailed)
          Positioned(
            left: 0,
            right: 0,
            bottom: 132,
            child: Center(
              // e.g. camera permission granted after the first attempt, or another app had the camera
              child: TextButton.icon(
                onPressed: _openCamera,
                style: TextButton.styleFrom(foregroundColor: Colors.white),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try the camera again'),
              ),
            ),
          ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 40,
          child: Center(
            child: PressScale(
              semanticLabel: 'Take selfie',
              onTap: (ready || _camFailed) ? _capture : null,
              child: Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 5),
                  color: Colors.white24,
                ),
                child: const Icon(Icons.camera_alt_rounded, color: Colors.white, size: 32),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _reviewStep(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Text('Use this photo?', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 16),
      Center(
        child: FadeSlideIn(
          child: ClipOval(
            child: SizedBox(
              width: 220,
              height: 280,
              child: Image.memory(_photo!, fit: BoxFit.cover, semanticLabel: 'Your selfie'),
            ),
          ),
        ),
      ),
      const SizedBox(height: 16),
      Text(
        'Make sure your whole face is clear and in focus.',
        textAlign: TextAlign.center,
        style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
      ),
      const SizedBox(height: 20),
      BusyButton(label: 'Submit selfie', icon: Icons.verified_user_outlined, busy: _busy, onPressed: _submit),
      TextButton(onPressed: _busy ? null : () => _go(_Step.camera), child: const Text('Retake')),
    ],
  );

  Widget _resultStep(BuildContext context) {
    final ok = _result?['status'] == 'passed';
    final cs = Theme.of(context).colorScheme;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 24),
        Center(
          child: ok
              ? const SuccessCheck()
              : TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0.6, end: 1),
                  duration: Motion.of(context, Motion.slow),
                  curve: Curves.elasticOut,
                  builder: (_, s, child) => Transform.scale(scale: s, child: child),
                  child: CircleAvatar(
                    radius: 44,
                    backgroundColor: cs.error.withValues(alpha: 0.12),
                    child: Icon(Icons.refresh_rounded, color: cs.error, size: 44),
                  ),
                ),
        ),
        const SizedBox(height: 20),
        Text(ok ? 'Selfie verified' : "That didn't work", textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(
          ok ? 'Now add your ID to finish.' : '${_result?['reason'] ?? 'Please try again.'}\n${_result?['attemptsLeft'] ?? 0} attempts left today.',
          textAlign: TextAlign.center,
          style: TextStyle(color: cs.onSurfaceVariant),
        ),
        const SizedBox(height: 24),
        if (ok)
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue'))
        else ...[
          if ((_result?['attemptsLeft'] ?? 0) > 0) FilledButton(onPressed: () => _go(_Step.camera), child: const Text('Try again')),
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Not now')),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final body = switch (_step) {
      _Step.tips => _tips(context),
      _Step.bvn => _bvnStep(context),
      _Step.camera => _cameraStep(context),
      _Step.review => _reviewStep(context),
      _Step.result => _resultStep(context),
    };
    final dark = _step == _Step.camera;
    return Scaffold(
      backgroundColor: dark ? Colors.black : null,
      appBar: AppBar(title: const Text('Selfie check'), backgroundColor: dark ? Colors.black : null, foregroundColor: dark ? Colors.white : null),
      body: AnimatedSwitcher(
        duration: Motion.of(context, Motion.medium),
        child: KeyedSubtree(key: ValueKey(_step), child: body),
      ),
    );
  }
}

class _OvalMask extends StatefulWidget {
  const _OvalMask();
  @override
  State<_OvalMask> createState() => _OvalMaskState();
}

class _OvalMaskState extends State<_OvalMask> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Respect "reduce motion": a still outline instead of a breathing one.
    if (Motion.reduced(context)) {
      _c.value = 0.5;
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: AnimatedBuilder(
      animation: _c,
      builder: (context, _) => CustomPaint(painter: _OvalPainter(_c.value, Theme.of(context).colorScheme.primary)),
    ),
  );
}

class _OvalPainter extends CustomPainter {
  _OvalPainter(this.t, this.color);
  final double t;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width * 0.72;
    final oval = Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.45), width: w, height: w * 1.3);
    final shade = Path()
      ..addRect(Offset.zero & size)
      ..addOval(oval)
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(shade, Paint()..color = Colors.black.withValues(alpha: 0.55));
    canvas.drawOval(
      oval.inflate(2 + 4 * t),
      Paint()
        ..color = color.withValues(alpha: 0.6 + 0.4 * t)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4,
    );
  }

  @override
  bool shouldRepaint(_OvalPainter old) => old.t != t || old.color != color;
}
