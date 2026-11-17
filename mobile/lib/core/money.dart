/// Formatting only. Amounts travel as decimal strings and are never stored as doubles.
class Money {
  static const symbols = {'NGN': '₦', 'USD': '\$'};

  static String group(String whole) {
    final b = StringBuffer();
    for (var i = 0; i < whole.length; i++) {
      if (i > 0 && (whole.length - i) % 3 == 0) b.write(',');
      b.write(whole[i]);
    }
    return b.toString();
  }

  /// "49950.00" -> "₦49,950.00"; crypto keeps its decimals and gets a suffix.
  static String format(String amount, String asset) {
    final neg = amount.startsWith('-');
    final s = neg ? amount.substring(1) : amount;
    final parts = s.split('.');
    final whole = group(parts[0]);
    final frac = parts.length > 1 ? '.${parts[1]}' : '';
    final sym = symbols[asset];
    final body = sym != null ? '$sym$whole$frac' : '$whole${_trim(frac)} $asset';
    return neg ? '-$body' : body;
  }

  static String _trim(String frac) {
    if (frac.isEmpty) return frac;
    var f = frac.replaceAll(RegExp(r'0+$'), '');
    if (f == '.') f = '';
    return f;
  }

  static double toDouble(String amount) => double.tryParse(amount) ?? 0;
}
