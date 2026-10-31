// Words that keep a search off the Search tab's popular list (#124), however many phones made
// it: profanity and slurs buyers shouldn't be shown as a suggestion. Matched against each whole
// word of the normalised term, so "class" never matches "ass". Add to it as abuse turns up.
export const BLOCKED_SEARCH_WORDS: ReadonlySet<string> = new Set([
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "cock",
  "cunt",
  "dick",
  "fuck",
  "fucker",
  "fucking",
  "motherfucker",
  "nigga",
  "nigger",
  "porn",
  "pussy",
  "sex",
  "shit",
  "slut",
  "whore",
  // Nigerian Pidgin and Yoruba insults.
  "ashawo",
  "mumu",
  "oloshi",
  "werey",
])
