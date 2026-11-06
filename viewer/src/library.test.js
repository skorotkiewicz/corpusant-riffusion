import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { activeLyric, clock, filterLibrary, linkedSongIndex, lyricHighlights, lyricLines, lyricParagraphs, lyricSegments, mediaUrl, readLibrary, songLink } from './library.js'

test('real export, search, sorting, and honest lyric timing', async () => {
  const text = '[Verse]\nHi 🌑 world.\n\n[Chorus]\nSing.'
  const clip = {
    id: 'one', title: 'First pressing', created_at: '2026-10-01', is_favorite: true,
    duration: { value: '65.5' }, operation: { sound_prompt: 'Accordion and trap' },
    lyrics: { value: { id: 'lyrics-one', text } },
    lyrics_timing: { status: 'completed', value: { lyrics_id: 'lyrics-one', markers: [[8, 3], [text.indexOf('Sing'), 20], [text.length, 22]] } },
  }
  const segments = lyricSegments(clip)
  assert.equal(segments.map((segment) => segment.text).join(''), text)
  assert.equal(activeLyric(segments, 0), -1)
  assert.equal(segments[activeLyric(segments, 3)].text.startsWith('Hi'), true)
  assert.equal(segments[activeLyric(segments, 20)].text, 'Sing.')
  assert.equal(lyricSegments({ ...clip, lyrics_timing: { status: 'not_requested' } })[0].time, null)
  assert.equal(lyricSegments({ ...clip, lyrics_timing: { ...clip.lyrics_timing, value: { ...clip.lyrics_timing.value, lyrics_id: 'wrong' } } })[0].time, null)
  assert.equal(mediaUrl('javascript:alert(1)'), '')
  assert.equal(mediaUrl('https://example.test/song.m4a'), 'https://example.test/song.m4a')
  assert.equal(clock(65.5), '1:05')
  assert.equal(clock(3661), '1:01:01')
  assert.equal(clock(-20), '0:00')

  const library = readLibrary({ clips: [clip, { id: 'two', title: 'Second pressing', created_at: '2026-10-02' }] })
  assert.equal(filterLibrary(library, '', 'all', 'newest')[0].id, 'two')
  assert.equal(filterLibrary(library, '', 'all', 'oldest')[0].id, 'one')
  assert.equal(filterLibrary(library, 'accordion world', 'all', 'title')[0].id, 'one')
  assert.equal(filterLibrary(library, '', 'favorites', 'newest').length, 1)
  assert.equal(filterLibrary(library, '', 'timed', 'newest').length, 1)
  assert.equal(filterLibrary(library, 'missing', 'all', 'newest').length, 0)
  assert.throws(() => readLibrary({ clips: [clip, clip] }))
  assert.throws(() => readLibrary({}))

  const ordered = filterLibrary(library, '', 'all', 'newest')
  assert.equal(linkedSongIndex(ordered, '?id=one'), 1)
  assert.equal(linkedSongIndex(ordered, '?id=missing'), 0)
  assert.equal(linkedSongIndex(ordered, ''), 0)
  assert.equal(linkedSongIndex([], '?id=one'), 0)
  assert.equal(songLink('one', 'https://example.com/?id=old#collection'), 'https://example.com/?id=one')
  const link = songLink('a + b/&', 'https://owner.github.io/music/?id=old#collection')
  assert.equal(link, 'https://owner.github.io/music/?id=a+%2B+b%2F%26')
  assert.equal(linkedSongIndex([{ id: 'other' }, { id: 'a + b/&' }], new URL(link).search), 1)

  const exported = await Bun.file(new URL('../public/songs.json', import.meta.url)).json()
  const records = readLibrary(exported)
  assert.equal(records.length, exported.clips.length)
  for (const record of records) {
    assert.equal(lyricSegments(record).map((segment) => segment.text).join(''), record.lyricsText)
    if (record.lyrics_timing?.status === 'completed') assert.equal(record.hasTiming, true, record.title)
  }
})

test('transcribed timing highlights original words without replacing formatting or native timing', () => {
  const raw = { id: 'one', title: 'Test', audio_url: 'https://example.test/one.m4a',
    lyrics: { value: { id: 'lyrics', text: '[Verse]\nRecognized 🌑\n\nwords!' } } }
  const entry = { status: 'completed', audio_url: raw.audio_url,
    words: [{ word: 'Recognized', start: 1, end: 2 }, { word: 'words', start: 3, end: 4 }] }
  const timing = { version: 1, songs: { one: entry } }
  const [clip] = readLibrary({ clips: [raw] }, timing)
  const segments = lyricSegments(clip)
  assert.equal(clip.hasTiming, true)
  assert.equal(clip.timingSource, 'transcription')
  assert.equal(clip.lyricsText, raw.lyrics.value.text)
  assert.equal(segments.map((segment) => segment.text).join(''), raw.lyrics.value.text)
  assert.equal(activeLyric(segments, 0), -1)
  assert.equal(segments[activeLyric(segments, 1.5)].text, 'Recognized')
  assert.equal(activeLyric(segments, 2.5), -1)
  assert.equal(segments[activeLyric(segments, 3)].text, 'words')
  assert.equal(activeLyric(segments, 4), -1)
  assert.equal(filterLibrary([clip], 'recognized', 'timed', 'title').length, 1)

  const [native] = readLibrary({ clips: [{ ...raw,
    lyrics_timing: { status: 'completed', value: { lyrics_id: 'lyrics', markers: [[0, 1]] } },
  }] }, timing)
  assert.equal(native.timingSource, 'export')
  assert.equal(lyricSegments(native)[0].text, raw.lyrics.value.text)

  for (const invalid of [
    { ...entry, audio_url: 'https://example.test/different.m4a' },
    { ...entry, status: 'no_speech', words: [] },
    { status: 'failed', audio_url: raw.audio_url, http_status: 400, error: 'Audio rejected' },
    { ...entry, words: [{ word: 'Bad', start: 3, end: 2 }] },
    { ...entry, words: [{ word: 'Bad', start: NaN, end: 2 }] },
    { ...entry, words: [{ word: 'Bad', start: 3, end: 4 }, { word: 'order', start: 1, end: 2 }] },
  ]) {
    const [fallback] = readLibrary({ clips: [raw] }, { version: 1, songs: { one: invalid } })
    assert.equal(fallback.hasTiming, false)
    assert.equal(lyricSegments(fallback)[0].text, raw.lyrics.value.text)
  }
  assert.equal(readLibrary({ clips: [raw] })[0].hasTiming, false)
  assert.equal(readLibrary({ clips: [raw] }, { version: 2, songs: timing.songs })[0].hasTiming, false)
  const [noLyrics] = readLibrary({ clips: [{ ...raw, lyrics: null }] }, timing)
  assert.equal(noLyrics.hasTiming, true)
})

test('word alignment preserves Unicode and punctuation, skips directions, and follows repeated choruses', () => {
  const text = '[Intro: hello]\n🌑 Héllo, don’t stop!\nA missing word.\n\n[Chorus]\nHello again.\nHello again!'
  const raw = { id: 'aligned', audio_url: 'https://example.test/song.m4a', lyrics: { value: { text } } }
  const words = ['hello', "don't", 'stop', 'extra', 'a', 'word', 'hello', 'again', 'hello', 'again']
    .map((word, index) => ({ word, start: index + 1, end: index + 1.5 }))
  const [clip] = readLibrary({ clips: [raw] }, { version: 1, songs: {
    aligned: { status: 'completed', audio_url: raw.audio_url, words },
  } })
  const segments = lyricSegments(clip)
  assert.equal(segments.map((segment) => segment.text).join(''), text)
  assert.equal(segments[activeLyric(segments, 1.2)].text, 'Héllo')
  assert.equal(segments[activeLyric(segments, 2.2)].text, 'don’t')
  assert.equal(activeLyric(segments, 4.2), -1)
  assert.equal(segments[activeLyric(segments, 7.2)].text, 'Hello')
  assert.equal(segments[activeLyric(segments, 9.2)].text, 'Hello')
  assert.ok(activeLyric(segments, 9.2) > activeLyric(segments, 7.2))
  assert.equal(segments.find((segment) => segment.text.includes('missing')).time, null)
  assert.equal(segments.find((segment) => segment.text.includes('[Intro: hello]')).time, null)
})

test('unrelated transcription leaves the complete original lyrics untimed', () => {
  const raw = { id: 'unmatched', audio_url: 'https://example.test/song.m4a',
    lyrics: { value: { text: '[Verse]\nOriginal words.\n' } } }
  const [clip] = readLibrary({ clips: [raw] }, { version: 1, songs: {
    unmatched: { status: 'completed', audio_url: raw.audio_url, words: [{ word: 'Different', start: 1, end: 2 }] },
  } })
  assert.equal(clip.hasTiming, false)
  assert.deepEqual(lyricSegments(clip), [{ text: raw.lyrics.value.text, time: null }])
})

test('API timing highlights complete original paragraphs through pauses between words', () => {
  const text = '[Verse]\nHello,\nbeautiful world!\n \n[Instrumental]\n\n[Chorus]\nHello again.\n'
  const raw = { id: 'paragraphs', audio_url: 'https://example.test/song.m4a', lyrics: { value: { text } } }
  const words = [{ word: 'Hello', start: 1, end: 2 }, { word: 'world', start: 4, end: 5 },
    { word: 'Hello', start: 10, end: 11 }, { word: 'again', start: 12, end: 13 }]
  const [clip] = readLibrary({ clips: [raw] }, { version: 1, songs: {
    paragraphs: { status: 'completed', audio_url: raw.audio_url, words },
  } })
  const paragraphs = lyricParagraphs(lyricSegments(clip))
  assert.equal(paragraphs.map((segment) => segment.text).join(''), text)
  assert.equal(paragraphs.filter((segment) => segment.paragraph).length, 3)
  assert.equal(paragraphs[activeLyric(paragraphs, 1)].text, '[Verse]\nHello,\nbeautiful world!')
  assert.equal(activeLyric(paragraphs, 3), activeLyric(paragraphs, 1))
  assert.equal(activeLyric(paragraphs, 5), -1)
  assert.equal(activeLyric(paragraphs, 8), -1)
  assert.equal(paragraphs[activeLyric(paragraphs, 11.5)].text, '[Chorus]\nHello again.\n')
  assert.equal(activeLyric(paragraphs, 13), -1)
  assert.equal(paragraphs.find((segment) => segment.text === '[Instrumental]').time, null)
  assert.equal(paragraphs.find((segment) => segment.paragraphBreak).blankLines, 1)
})

test('paragraph grouping preserves Windows line breaks, extra blank lines, and untimed text', () => {
  const text = '\r\n\r\nFirst\r\n\r\n\r\nSecond\r\n'
  const paragraphs = lyricParagraphs([{ text, time: null }])
  assert.equal(paragraphs.map((segment) => segment.text).join(''), text)
  assert.deepEqual(paragraphs.filter((segment) => segment.paragraphBreak).map((segment) => segment.blankLines), [2, 2])
  assert.equal(activeLyric(paragraphs, 100), -1)
  assert.deepEqual(lyricParagraphs([]), [])
})

test('API timing follows the current written lyric line within a verse', () => {
  const text = '[Verse]\nHello, world!\nStay with me.\n\n[Chorus]\nSing again.'
  const raw = { id: 'lines', audio_url: 'https://example.test/song.m4a', lyrics: { value: { text } } }
  const words = ['Hello', 'world', 'Stay', 'me', 'Sing', 'again']
    .map((word, index) => ({ word, start: index * 2 + 1, end: index * 2 + 2 }))
  const [clip] = readLibrary({ clips: [raw] }, { version: 1, songs: {
    lines: { status: 'completed', audio_url: raw.audio_url, words },
  } })
  const highlights = lyricHighlights(lyricSegments(clip))
  assert.equal(highlights.map((segment) => segment.text).join(''), text)
  assert.equal(highlights[activeLyric(highlights, 2.5)].text, 'Hello, world!')
  assert.equal(highlights[activeLyric(highlights, 5.5)].text, 'Stay with me.')
  assert.equal(highlights[activeLyric(highlights, 9.5)].text, 'Sing again.')
  assert.equal(activeLyric(highlights, 4.5), -1)
  assert.equal(highlights.find((segment) => segment.text === '[Verse]').time, null)
  assert.ok(highlights.filter((segment) => segment.time !== null).every((segment) => segment.line))
})

test('uncertain line boundaries fall back to their paragraph while other verses keep line highlights', () => {
  const text = '[Verse]\nHello, world!\nAn unrecognized ending.\n\n[Chorus]\nSing again.\nOne more.'
  const raw = { id: 'fallback', audio_url: 'https://example.test/song.m4a', lyrics: { value: { text } } }
  const words = ['Hello', 'world', 'An', 'Sing', 'again', 'One', 'more']
    .map((word, index) => ({ word, start: index * 2 + 1, end: index * 2 + 2 }))
  const [clip] = readLibrary({ clips: [raw] }, { version: 1, songs: {
    fallback: { status: 'completed', audio_url: raw.audio_url, words },
  } })
  const highlights = lyricHighlights(lyricSegments(clip))
  assert.equal(highlights.map((segment) => segment.text).join(''), text)
  const verse = highlights[activeLyric(highlights, 3)]
  assert.equal(verse.text, '[Verse]\nHello, world!\nAn unrecognized ending.')
  assert.equal(verse.paragraph, true)
  assert.equal(highlights[activeLyric(highlights, 7.5)].text, 'Sing again.')
  assert.equal(highlights[activeLyric(highlights, 11.5)].text, 'One more.')
  assert.equal(activeLyric(highlights, 14), -1)
})

test('line grouping preserves Windows line endings, blank lines, and one-word lyrics', () => {
  const text = '[Verse]\r\nHello\r\n\r\n'
  const highlights = lyricHighlights([{ text: '[Verse]\r\n', time: null },
    { text: 'Hello', time: 1, end: 2 }, { text: '\r\n\r\n', time: null }])
  assert.equal(highlights.map((segment) => segment.text).join(''), text)
  assert.equal(highlights[activeLyric(highlights, 1.5)].text, 'Hello')
  assert.equal(highlights[activeLyric(highlights, 1.5)].line, true)
  assert.deepEqual(lyricLines([]), [])
  assert.deepEqual(lyricHighlights([]), [])
})
