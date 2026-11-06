export function linkedSongIndex(clips, search) {
  const id = new URLSearchParams(search).get('id')
  return Math.max(0, clips.findIndex((clip) => clip.id === id))
}

export function songLink(id, href) {
  const url = new URL(href)
  url.searchParams.set('id', id)
  url.hash = ''
  return url.href
}

export function mediaUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

export function durationOf(clip) {
  const value = Number(clip.duration?.value)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function clock(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(total % 60).padStart(2, '0')}`
}

function lyricWords(text) {
  return [...text.matchAll(/\[[^\]]*\]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
    .filter((match) => !match[0].startsWith('['))
    .map((match) => ({
      start: match.index, end: match.index + match[0].length,
      key: match[0].normalize('NFKD').toLocaleLowerCase().replace(/\p{M}|['’]/gu, ''),
    }))
}

function alignWordTiming(text, words) {
  const original = lyricWords(text)
  const recognized = words.flatMap((word, index) => lyricWords(word.word)
    .map((token) => ({ key: token.key, time: word.start, end: word.end, wordIndex: index })))
  // Match the complete sequences so repeated choruses and missing words keep their order.
  const width = recognized.length + 1
  const matches = new Uint32Array((original.length + 1) * width)
  for (let i = original.length - 1; i >= 0; i--) {
    for (let j = recognized.length - 1; j >= 0; j--) {
      matches[i * width + j] = original[i].key === recognized[j].key
        ? 1 + matches[(i + 1) * width + j + 1]
        : Math.max(matches[(i + 1) * width + j], matches[i * width + j + 1])
    }
  }
  const aligned = []
  let i = 0, j = 0
  while (i < original.length && j < recognized.length) {
    if (original[i].key === recognized[j].key) {
      const previous = aligned[aligned.length - 1]
      if (previous?.wordIndex === recognized[j].wordIndex && previous.sourceIndex === i - 1) {
        previous.endOffset = original[i].end
        previous.sourceIndex = i
      } else {
        aligned.push({ ...recognized[j], startOffset: original[i].start, endOffset: original[i].end, sourceIndex: i })
      }
      i++
      j++
    } else if (matches[(i + 1) * width + j] >= matches[i * width + j + 1]) i++
    else j++
  }
  const segments = []
  let offset = 0
  for (const word of aligned) {
    if (word.startOffset > offset) segments.push({ text: text.slice(offset, word.startOffset), time: null })
    segments.push({ text: text.slice(word.startOffset, word.endOffset), time: word.time, end: word.end, transcribed: true })
    offset = word.endOffset
  }
  if (offset < text.length) segments.push({ text: text.slice(offset), time: null })
  return segments
}

function transcribedSegments(clip) {
  const timing = clip.transcriptionTiming
  if (timing?.status !== 'completed' || timing.audio_url !== clip.audio_url ||
      !Array.isArray(timing.words) || !timing.words.length) return []
  const valid = timing.words.every((word, index) => word && typeof word.word === 'string' && word.word.trim() &&
    Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end >= word.start &&
    (!index || word.start >= timing.words[index - 1].start))
  if (!valid) return []
  const text = clip.lyrics?.value?.text
  if (typeof text === 'string' && text) return alignWordTiming(text, timing.words)
  return timing.words.map((word, index) => ({
    text: word.word.trim() + (index < timing.words.length - 1 ? ' ' : ''),
    time: word.start, end: word.end, transcribed: true,
  }))
}

export function lyricSegments(clip) {
  const lyrics = clip.lyrics?.value
  const text = typeof lyrics?.text === 'string' ? lyrics.text : ''
  if (!text) return transcribedSegments(clip)
  const timing = clip.lyrics_timing
  const markers = timing?.value?.markers
  const valid = timing?.status === 'completed' &&
    timing.value.lyrics_id === lyrics.id && Array.isArray(markers) && markers.length > 0 &&
    markers.every((marker, index) => Array.isArray(marker) && marker.length === 2 &&
      Number.isInteger(marker[0]) && marker[0] >= 0 && marker[0] <= text.length &&
      Number.isFinite(marker[1]) && marker[1] >= 0 &&
      (!index || (marker[0] > markers[index - 1][0] && marker[1] >= markers[index - 1][1]))) &&
    markers[0][0] < text.length
  if (!valid) {
    const transcribed = transcribedSegments(clip)
    return transcribed.length ? transcribed : [{ text, time: null }]
  }
  const sections = markers.map(([offset, time], index) => ({
    text: text.slice(offset, markers[index + 1]?.[0] ?? text.length), time,
  }))
  if (markers[0][0] > 0) sections.unshift({ text: text.slice(0, markers[0][0]), time: null })
  return sections.filter((section) => section.text.length > 0)
}

function segmentRanges(segments) {
  let offset = 0
  return segments.map((segment) => {
    const start = offset
    offset += segment.text.length
    return { ...segment, startOffset: start, endOffset: offset }
  })
}

export function lyricParagraphs(segments) {
  const ranges = segmentRanges(segments)
  const text = segments.map((segment) => segment.text).join('')
  let offset = 0
  return text.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/).flatMap((part, index) => {
    const start = offset
    offset += part.length
    if (!part) return []
    if (index % 2) {
      return [{ text: part, time: null, paragraphBreak: true,
        blankLines: part.split('\n').length - (start ? 2 : 1) }]
    }
    const timed = ranges.filter((range) => range.time !== null && range.endOffset > start && range.startOffset < offset)
    return [{ text: part, time: timed[0]?.time ?? null,
      end: timed.length ? Math.max(...timed.map((range) => range.end)) : undefined, paragraph: true }]
  })
}

export function lyricLines(segments) {
  const ranges = segmentRanges(segments)
  const text = segments.map((segment) => segment.text).join('')
  let offset = 0
  return text.split(/(\r\n|\n|\r)/).flatMap((part, index) => {
    const start = offset
    offset += part.length
    if (!part) return []
    if (index % 2) return [{ text: part, time: null }]
    const timed = ranges.filter((range) => range.time !== null && range.endOffset > start && range.startOffset < offset)
    const words = lyricWords(part)
    const anchored = (word) => timed.some((range) => !/[\r\n]/.test(range.text) &&
      range.startOffset <= start + word.start && range.endOffset >= start + word.end)
    // Both ends must be matched to give the written line a useful time range.
    const reliable = !words.length || anchored(words[0]) && anchored(words[words.length - 1])
    return [{ text: part, time: timed[0]?.time ?? null,
      end: timed.length ? Math.max(...timed.map((range) => range.end)) : undefined, line: true, reliable }]
  })
}

export function lyricHighlights(segments) {
  const ranges = segmentRanges(segments)
  let offset = 0
  return lyricParagraphs(segments).flatMap((paragraph) => {
    const start = offset
    offset += paragraph.text.length
    if (paragraph.paragraphBreak) return [paragraph]
    const words = ranges.filter((range) => range.endOffset > start && range.startOffset < offset)
      .map((range) => ({ ...range, text: range.text.slice(Math.max(0, start - range.startOffset), Math.min(range.text.length, offset - range.startOffset)) }))
    const lines = lyricLines(words)
    return lines.some((line) => line.line && !line.reliable) ? [paragraph] : lines
  })
}

export function activeLyric(segments, time) {
  let current = -1
  for (let index = 0; index < segments.length; index++) {
    if (segments[index].time !== null && segments[index].time <= time) {
      current = segments[index].end === undefined || time < segments[index].end ? index : -1
    }
  }
  return current
}

export function readLibrary(data, timing = null) {
  if (!Array.isArray(data?.clips)) throw new Error('Expected a songs.json export containing a clips array.')
  const ids = new Set()
  return data.clips.map((raw) => {
    if (!raw || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) {
      throw new Error('Every clip must have a unique ID. Check the JSON export.')
    }
    ids.add(raw.id)
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Untitled song'
    const lyrics = typeof raw.lyrics?.value?.text === 'string' ? raw.lyrics.value.text : ''
    const prompt = typeof raw.operation?.sound_prompt === 'string' ? raw.operation.sound_prompt : ''
    const clip = { ...raw, transcriptionTiming: timing?.version === 1 ? timing.songs?.[raw.id] : undefined }
    const segments = lyricSegments(clip)
    const transcribed = segments.some((segment) => segment.transcribed)
    return {
      ...clip, raw, title, prompt, lyricsText: lyrics, durationSeconds: durationOf(raw),
      audioUrl: mediaUrl(raw.audio_url), imageUrl: mediaUrl(raw.image_url), wavUrl: mediaUrl(raw.wav_url),
      hasTiming: segments.some((segment) => segment.time !== null),
      timingSource: transcribed ? 'transcription' : 'export',
      searchText: `${title}\n${prompt}\n${lyrics}\n${transcribed ? segments.map((segment) => segment.text).join('') : ''}`.toLocaleLowerCase(),
    }
  })
}

export function filterLibrary(clips, query, filter, sort) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return clips.filter((clip) =>
    (filter !== 'favorites' || clip.is_favorite) &&
    (filter !== 'timed' || clip.hasTiming) &&
    words.every((word) => clip.searchText.includes(word)),
  ).sort((left, right) => {
    if (sort === 'title') return left.title.localeCompare(right.title)
    if (sort === 'longest') return right.durationSeconds - left.durationSeconds
    const difference = (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0)
    return sort === 'oldest' ? -difference : difference
  })
}
