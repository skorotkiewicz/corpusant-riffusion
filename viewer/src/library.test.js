import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { activeLyric, clock, filterLibrary, lyricSegments, mediaUrl, readLibrary } from './library.js'

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

  const exported = await Bun.file(new URL('../public/songs.json', import.meta.url)).json()
  const records = readLibrary(exported)
  assert.equal(records.length, exported.clips.length)
  for (const record of records) {
    assert.equal(lyricSegments(record).map((segment) => segment.text).join(''), record.lyricsText)
    if (record.lyrics_timing?.status === 'completed') assert.equal(record.hasTiming, true, record.title)
  }
})
