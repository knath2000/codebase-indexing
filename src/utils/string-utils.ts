/**
 * Simple Unicode-aware string width utilities
 * Alternative to string-width package for basic width calculation
 */

/**
 * Calculate the display width of a string, accounting for:
 * - Control characters (width 0)
 * - Combining characters (width 0) 
 * - Wide characters like emojis (width 2)
 * - Regular characters (width 1)
 */
export function getStringWidth(str: string): number {
  let width = 0
  
  for (const char of str) {
    const codePoint = char.codePointAt(0)!
    
    // Control characters and combining marks have zero width
    if (codePoint < 32 || (codePoint >= 0x300 && codePoint <= 0x36F)) {
      continue
    }
    
    // Wide characters (including emojis) have width 2
    if (isWideCharacter(codePoint)) {
      width += 2
    } else {
      width += 1
    }
  }
  
  return width
}

/**
 * Truncate string to a specific display width, respecting Unicode boundaries
 */
export function truncateToWidth(str: string, maxWidth: number): string {
  if (getStringWidth(str) <= maxWidth) {
    return str
  }
  
  let result = ''
  let currentWidth = 0
  
  for (const char of str) {
    const codePoint = char.codePointAt(0)!
    let charWidth = 0
    
    // Control characters and combining marks have zero width
    if (codePoint >= 32 && !(codePoint >= 0x300 && codePoint <= 0x36F)) {
      charWidth = isWideCharacter(codePoint) ? 2 : 1
    }
    
    if (currentWidth + charWidth > maxWidth) {
      break
    }
    
    result += char
    currentWidth += charWidth
  }
  
  return result
}

/**
 * Check if a Unicode code point represents a wide character
 * Based on East Asian Width property and common emoji ranges
 */
function isWideCharacter(codePoint: number): boolean {
  // Emoji ranges
  if (
    (codePoint >= 0x1F600 && codePoint <= 0x1F64F) || // Emoticons
    (codePoint >= 0x1F300 && codePoint <= 0x1F5FF) || // Misc Symbols and Pictographs
    (codePoint >= 0x1F680 && codePoint <= 0x1F6FF) || // Transport and Map
    (codePoint >= 0x1F1E0 && codePoint <= 0x1F1FF) || // Regional indicators
    (codePoint >= 0x2600 && codePoint <= 0x26FF) ||   // Misc symbols
    (codePoint >= 0x2700 && codePoint <= 0x27BF)      // Dingbats
  ) {
    return true
  }
  
  // East Asian Wide characters
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115F) ||   // Hangul Jamo
    (codePoint >= 0x2E80 && codePoint <= 0x2EFF) ||   // CJK Radicals Supplement
    (codePoint >= 0x2F00 && codePoint <= 0x2FDF) ||   // Kangxi Radicals
    (codePoint >= 0x3000 && codePoint <= 0x303F) ||   // CJK Symbols and Punctuation
    (codePoint >= 0x3040 && codePoint <= 0x309F) ||   // Hiragana
    (codePoint >= 0x30A0 && codePoint <= 0x30FF) ||   // Katakana
    (codePoint >= 0x3100 && codePoint <= 0x312F) ||   // Bopomofo
    (codePoint >= 0x3130 && codePoint <= 0x318F) ||   // Hangul Compatibility Jamo
    (codePoint >= 0x3190 && codePoint <= 0x319F) ||   // Kanbun
    (codePoint >= 0x31A0 && codePoint <= 0x31BF) ||   // Bopomofo Extended
    (codePoint >= 0x31C0 && codePoint <= 0x31EF) ||   // CJK Strokes
    (codePoint >= 0x31F0 && codePoint <= 0x31FF) ||   // Katakana Phonetic Extensions
    (codePoint >= 0x3200 && codePoint <= 0x32FF) ||   // Enclosed CJK Letters and Months
    (codePoint >= 0x3300 && codePoint <= 0x33FF) ||   // CJK Compatibility
    (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||   // CJK Extension A
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||   // CJK Unified Ideographs
    (codePoint >= 0xA000 && codePoint <= 0xA48F) ||   // Yi Syllables
    (codePoint >= 0xA490 && codePoint <= 0xA4CF) ||   // Yi Radicals
    (codePoint >= 0xAC00 && codePoint <= 0xD7AF) ||   // Hangul Syllables
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (codePoint >= 0xFE10 && codePoint <= 0xFE1F) ||   // Vertical Forms
    (codePoint >= 0xFE30 && codePoint <= 0xFE4F) ||   // CJK Compatibility Forms
    (codePoint >= 0xFE50 && codePoint <= 0xFE6F) ||   // Small Form Variants
    (codePoint >= 0xFF00 && codePoint <= 0xFFEF) ||   // Halfwidth and Fullwidth Forms
    (codePoint >= 0x20000 && codePoint <= 0x2A6DF) || // CJK Extension B
    (codePoint >= 0x2A700 && codePoint <= 0x2B73F) || // CJK Extension C
    (codePoint >= 0x2B740 && codePoint <= 0x2B81F) || // CJK Extension D
    (codePoint >= 0x2B820 && codePoint <= 0x2CEAF)    // CJK Extension E
  ) {
    return true
  }
  
  return false
}