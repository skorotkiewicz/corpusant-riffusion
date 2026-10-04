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

export function lyricSegments(clip) {
  const lyrics = clip.lyrics?.value
  const text = typeof lyrics?.text === 'string' ? lyrics.text : ''
  if (!text) return []
  const timing = clip.lyrics_timing
  const markers = timing?.value?.markers
  const valid = timing?.status === 'completed' &&
    timing.value.lyrics_id === lyrics.id && Array.isArray(markers) && markers.length > 0 &&
    markers.every((marker, index) => Array.isArray(marker) && marker.length === 2 &&
      Number.isInteger(marker[0]) && marker[0] >= 0 && marker[0] <= text.length &&
      Number.isFinite(marker[1]) && marker[1] >= 0 &&
      (!index || (marker[0] > markers[index - 1][0] && marker[1] >= markers[index - 1][1])))
  if (!valid) return [{ text, time: null }]
  const sections = markers.map(([offset, time], index) => ({
    text: text.slice(offset, markers[index + 1]?.[0] ?? text.length), time,
  }))
  if (markers[0][0] > 0) sections.unshift({ text: text.slice(0, markers[0][0]), time: null })
  return sections.filter((section) => section.text.length > 0)
}

export function activeLyric(segments, time) {
  let current = -1
  for (let index = 0; index < segments.length; index++) {
    if (segments[index].time !== null && segments[index].time <= time) current = index
  }
  return current
}

export function readLibrary(data) {
  if (!Array.isArray(data?.clips)) throw new Error('Expected a songs.json export containing a clips array.')
  const ids = new Set()
  return data.clips.map((raw) => {
    if (!raw || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) {
      throw new Error('Every clip must have a unique ID. Check the JSON export.')
    }
    ids.add(raw.id)
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Untitled pressing'
    const lyrics = typeof raw.lyrics?.value?.text === 'string' ? raw.lyrics.value.text : ''
    const prompt = typeof raw.operation?.sound_prompt === 'string' ? raw.operation.sound_prompt : ''
    return {
      ...raw, raw, title, prompt, lyricsText: lyrics, durationSeconds: durationOf(raw),
      audioUrl: mediaUrl(raw.audio_url), imageUrl: mediaUrl(raw.image_url), wavUrl: mediaUrl(raw.wav_url),
      hasTiming: lyricSegments(raw).some((segment) => segment.time !== null),
      searchText: `${title}\n${prompt}\n${lyrics}`.toLocaleLowerCase(),
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
