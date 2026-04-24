/**
 * numberToWords.js — convert a number to English words, grammatically correct.
 *
 *   numberToWords(125000)          → "one hundred twenty-five thousand"
 *   numberToWords(125000, true)    → "One hundred twenty-five thousand"
 *   numberToWords(2500.75)         → "two thousand five hundred and 75/100"
 *   numberToWords(2500.75, false, { currency: 'dollars' })
 *                                  → "two thousand five hundred dollars and 75/100"
 *
 * Notes:
 * - American English convention: no "and" between the thousand groups (so
 *   "one hundred twenty-five thousand", NOT "one hundred and twenty-five
 *   thousand"). The word "and" is reserved for the decimal boundary.
 * - Decimals render as N/100 — standard for contract amounts. Pass
 *   { decimalWords: true } to get "seventy-five hundredths" instead.
 * - Handles integers up to 10^18 − 1 (quintillion). Negative numbers get
 *   "negative " prefix.
 */
(function (global) {
  const ONES = [
    'zero','one','two','three','four','five','six','seven','eight','nine',
    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
    'seventeen','eighteen','nineteen'
  ];
  const TENS = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const SCALES = ['', 'thousand','million','billion','trillion','quadrillion','quintillion'];

  function under1000(n) {
    n = Math.floor(n);
    const parts = [];
    if (n >= 100) {
      parts.push(ONES[Math.floor(n / 100)] + ' hundred');
      n = n % 100;
    }
    if (n > 0) {
      if (n < 20) parts.push(ONES[n]);
      else {
        const tens = Math.floor(n / 10), ones = n % 10;
        parts.push(ones === 0 ? TENS[tens] : TENS[tens] + '-' + ONES[ones]);
      }
    }
    return parts.join(' ');
  }

  function integerToWords(n) {
    if (n === 0) return 'zero';
    const neg = n < 0;
    n = Math.abs(n);
    const groups = [];
    while (n > 0) {
      groups.push(n % 1000);
      n = Math.floor(n / 1000);
    }
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i] === 0) continue;
      const text = under1000(groups[i]);
      parts.push(SCALES[i] ? text + ' ' + SCALES[i] : text);
    }
    return (neg ? 'negative ' : '') + parts.join(' ');
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function numberToWords(input, capitalized = false, opts = {}) {
    if (input === '' || input == null) return '';
    const num = typeof input === 'number' ? input : Number(String(input).replace(/,/g, ''));
    if (!isFinite(num)) return '';

    const integerPart = Math.trunc(num);
    const centsRaw   = Math.round((Math.abs(num) - Math.abs(integerPart)) * 100);
    const intWords   = integerToWords(integerPart);
    const currency   = opts.currency ? ' ' + opts.currency : '';

    let out = intWords + currency;
    if (centsRaw > 0) {
      out += ' and ' + (opts.decimalWords
        ? integerToWords(centsRaw) + (centsRaw === 1 ? ' hundredth' : ' hundredths')
        : String(centsRaw).padStart(2, '0') + '/100');
    }
    return capitalized ? capitalize(out) : out;
  }

  // Expose both as ES module and browser global
  if (typeof module !== 'undefined' && module.exports) module.exports = { numberToWords, integerToWords };
  else global.numberToWords = numberToWords;
})(typeof window !== 'undefined' ? window : this);
