// The characters a Dhivehi font can contain, grouped the way a designer works
// through them: the 24 core letters first, then the fili (vowel marks), then
// the extended letters used for Arabic loanwords, then everything else.

export type GlyphKind = 'letter' | 'markAbove' | 'markBelow' | 'other'

export interface CharInfo {
  cp: number
  char: string
  name: string
  kind: GlyphKind
  group: GroupId
}

export type GroupId = 'core' | 'fili' | 'extended' | 'numbers' | 'latin'

export interface GroupInfo {
  id: GroupId
  title: string
  dhivehi: string
  hint: string
  required: boolean
}

export const GROUPS: GroupInfo[] = [
  { id: 'core', title: 'Thaana letters', dhivehi: 'ތާނަ އަކުރު', hint: 'The 24 core letters. Draw these first.', required: true },
  { id: 'fili', title: 'Fili', dhivehi: 'ފިލި', hint: 'Vowel marks. Draw them above or below the guide letter and they will sit on every letter.', required: true },
  { id: 'extended', title: 'Extended letters', dhivehi: 'ތިކިޖެހި ތާނަ', hint: 'Dotted letters for Arabic loanwords.', required: false },
  { id: 'numbers', title: 'Numbers & punctuation', dhivehi: 'އަދަދު', hint: 'Digits and the marks you need to write a sentence.', required: false },
  { id: 'latin', title: 'Latin (optional)', dhivehi: 'އިނގިރޭސި', hint: 'English letters, if you want a bilingual font.', required: false },
]

const CORE: [number, string][] = [
  [0x0780, 'Haa'], [0x0781, 'Shaviyani'], [0x0782, 'Noonu'], [0x0783, 'Raa'],
  [0x0784, 'Baa'], [0x0785, 'Lhaviyani'], [0x0786, 'Kaafu'], [0x0787, 'Alifu'],
  [0x0788, 'Vaavu'], [0x0789, 'Meemu'], [0x078a, 'Faafu'], [0x078b, 'Dhaalu'],
  [0x078c, 'Thaa'], [0x078d, 'Laamu'], [0x078e, 'Gaafu'], [0x078f, 'Gnaviyani'],
  [0x0790, 'Seenu'], [0x0791, 'Daviyani'], [0x0792, 'Zaviyani'], [0x0793, 'Taviyani'],
  [0x0794, 'Yaa'], [0x0795, 'Paviyani'], [0x0796, 'Javiyani'], [0x0797, 'Chaviyani'],
]

const FILI: [number, string, GlyphKind][] = [
  [0x07a6, 'Abafili', 'markAbove'], [0x07a7, 'Aabaafili', 'markAbove'],
  [0x07a8, 'Ibifili', 'markBelow'], [0x07a9, 'Eebeefili', 'markBelow'],
  [0x07aa, 'Ubufili', 'markAbove'], [0x07ab, 'Ooboofili', 'markAbove'],
  [0x07ac, 'Ebefili', 'markAbove'], [0x07ad, 'Eybeyfili', 'markAbove'],
  [0x07ae, 'Obofili', 'markAbove'], [0x07af, 'Oaboafili', 'markAbove'],
  [0x07b0, 'Sukun', 'markAbove'],
]

const EXTENDED: [number, string][] = [
  [0x0798, 'Ttaa'], [0x0799, 'Hhaa'], [0x079a, 'Khaa'], [0x079b, 'Thaalu'],
  [0x079c, 'Zaa'], [0x079d, 'Sheenu'], [0x079e, 'Saadhu'], [0x079f, 'Daadhu'],
  [0x07a0, 'To'], [0x07a1, 'Zo'], [0x07a2, 'Ainu'], [0x07a3, 'Ghainu'],
  [0x07a4, 'Qaafu'], [0x07a5, 'Waavu'], [0x07b1, 'Naa'],
]

const NUMBERS: [number, string][] = [
  ...Array.from({ length: 10 }, (_, i) => [0x30 + i, `Digit ${i}`] as [number, string]),
  [0x060c, 'Arabic comma'], [0x061b, 'Arabic semicolon'], [0x061f, 'Arabic question mark'],
  [0x2e, 'Full stop'], [0x21, 'Exclamation'], [0x3a, 'Colon'], [0x2d, 'Hyphen'],
  [0x28, 'Left parenthesis'], [0x29, 'Right parenthesis'], [0x22, 'Quote'], [0x27, 'Apostrophe'],
  [0x2f, 'Slash'], [0x2c, 'Comma'], [0x3f, 'Question mark'],
]

const LATIN: [number, string][] = [
  ...Array.from({ length: 26 }, (_, i) => [0x41 + i, `Capital ${String.fromCharCode(0x41 + i)}`] as [number, string]),
  ...Array.from({ length: 26 }, (_, i) => [0x61 + i, `Small ${String.fromCharCode(0x61 + i)}`] as [number, string]),
]

function make(list: [number, string][], group: GroupId, kind: GlyphKind): CharInfo[] {
  return list.map(([cp, name]) => ({ cp, char: String.fromCodePoint(cp), name, kind, group }))
}

export const CHARS: CharInfo[] = [
  ...make(CORE, 'core', 'letter'),
  ...FILI.map(([cp, name, kind]) => ({ cp, char: String.fromCodePoint(cp), name, kind, group: 'fili' as const })),
  ...make(EXTENDED, 'extended', 'letter'),
  ...make(NUMBERS, 'numbers', 'other'),
  ...make(LATIN, 'latin', 'other'),
]

export const CHAR_BY_CP = new Map(CHARS.map((c) => [c.cp, c]))

export const isMark = (kind: GlyphKind) => kind === 'markAbove' || kind === 'markBelow'

/** The letter fili are drawn against in the editor, and measured against when compiling. */
export const GUIDE_BASE_CP = 0x0784 // ބ baa

/** What a glyph cell shows: marks get a dotted circle so they are visible on their own. */
export function displayChar(c: CharInfo): string {
  return isMark(c.kind) ? '◌' + c.char : c.char
}
