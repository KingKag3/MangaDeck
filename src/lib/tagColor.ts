/**
 * A colour for a genre tag, so tags can be told apart at a glance. Familiar genres get a colour that fits them
 * (action red, romance pink, fantasy purple …); any other tag gets a steady colour of its own from its name, so the
 * same tag looks the same everywhere.
 */

/** First match wins, so put the more specific words first. */
const RULES: [RegExp, number][] = [
  [/rape|sexual|nudity|ecchi|mature|erotic|smut|hentai|lolicon|shotacon|incest/, 340], // adult content: hot pink-red
  [/gore|violence|blood|cannibal|torture|murder|suicide|abuse/, 355], // dark red
  [/horror|thriller|psycholog|tragedy|dark|survival/, 300], // magenta
  [/romance|love|harem|shoujo|josei|yuri|yaoi|bl\b|gl\b|dating|marriage/, 328], // pink
  [/comedy|gag|parody|humor|satire|slapstick/, 48], // yellow
  [/slice of life|iyashikei|cooking|food|music|idol|school|daily/, 118], // green
  [/isekai|reincarnat|transport|villainess|game|rpg|virtual/, 262], // violet
  [/fantasy|magic|supernatural|youkai|demon|ghost|vampire|mythology|religion|exorcis/, 275], // purple
  [/sci-?fi|science|mecha|robot|cyber|space|time travel|alien|technology/, 185], // cyan
  [/mystery|detective|crime|police|conspiracy|spy|gangster|yakuza|assassin/, 205], // steel blue
  [/drama|military|historical|war|politic|samurai|medical|business/, 225], // blue
  [/sports?|martial|fight|boxing|soccer|basketball|baseball|racing|tournament/, 22], // orange
  [/action|adventure|super ?power|superhero|shounen|shonen|battle|hero|ninja/, 6], // red
  [/seinen|webtoon|manhwa|manhua|full color|long strip|official/, 160], // teal
];

/** A hue (0–359) for any string, the same every time. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function tagHue(tag: string): number {
  const t = tag.toLowerCase().trim();
  const rule = RULES.find(([re]) => re.test(t));
  return rule ? rule[1] : hashHue(t);
}

/** CSS colour for a tag, readable on the dark background. */
export function tagColor(tag: string): string {
  return `hsl(${tagHue(tag)} 70% 68%)`;
}
