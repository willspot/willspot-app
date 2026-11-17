/// Mirrors backend/packages/common/src/schemas.ts. Both sides are tested with the
/// same cases (test/validation_test.dart and common.test.ts) so the app never
/// accepts what the server rejects, or the reverse.
class Validation {
  static const passwordMinLength = 10;

  static String? password(String? v) {
    final s = v ?? '';
    if (s.length < passwordMinLength) return 'Use at least $passwordMinLength characters';
    if (s.length > 128) return 'Too long';
    if (!RegExp(r'[a-z]').hasMatch(s)) return 'Add a lowercase letter';
    if (!RegExp(r'[A-Z]').hasMatch(s)) return 'Add an uppercase letter';
    if (!RegExp(r'\d').hasMatch(s)) return 'Add a number';
    return null;
  }

  static String? email(String? v) {
    final s = (v ?? '').trim();
    if (s.isEmpty || s.length > 254 || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(s)) return 'Enter a valid email';
    return null;
  }

  /// Normalises to +234XXXXXXXXXX, or returns null if invalid.
  static String? normalisePhone(String? v) {
    var s = (v ?? '').trim().replaceAll(RegExp(r'[\s-]'), '');
    if (s.startsWith('0')) {
      s = '+234${s.substring(1)}';
    } else if (s.startsWith('234')) {
      s = '+$s';
    }
    return RegExp(r'^\+234[789][01]\d{8}$').hasMatch(s) ? s : null;
  }

  static String? phone(String? v) => normalisePhone(v) == null ? 'Enter a valid Nigerian mobile number' : null;

  static const _weakPins = {
    '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
    '1234', '4321', '1212', '0123', '2580',
  };

  static String? pin(String? v) {
    final s = v ?? '';
    if (!RegExp(r'^\d{4}$').hasMatch(s)) return 'PIN must be 4 digits';
    if (_weakPins.contains(s)) return 'Choose a less obvious PIN';
    return null;
  }

  static String? name(String? v) {
    final s = (v ?? '').trim();
    if (s.isEmpty || s.length > 60) return 'Required';
    if (!RegExp(r"^[\p{L}' -]+$", unicode: true).hasMatch(s)) return 'Letters only';
    return null;
  }

  static String? amount(String? v, {double min = 0}) {
    final s = (v ?? '').replaceAll(',', '').trim();
    if (!RegExp(r'^\d{1,15}(\.\d{1,8})?$').hasMatch(s)) return 'Enter an amount';
    if ((double.tryParse(s) ?? 0) < min) return 'Minimum is ${min.toStringAsFixed(0)}';
    return null;
  }
}
