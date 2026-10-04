import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Disc3, Heart, ListMusic, LoaderCircle, Music2, Pause, Play, RefreshCw, Search, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-preact'
import { activeLyric, clock, filterLibrary, lyricSegments, readLibrary } from './library.js'
import './app.css'

const PAGE_SIZE = 24
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : dateFormat.format(date)
}

function Cover({ clip, className = '', small = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [clip?.imageUrl])
  return <div class={`cover ${className}`}>
    {clip?.imageUrl && !failed
      ? <img src={clip.imageUrl} alt="" loading={small ? 'lazy' : 'eager'} onError={() => setFailed(true)} />
      : <div class="cover-fallback"><Disc3 size={small ? 24 : 100} strokeWidth={1} />{!small && <span>A sleeve yet to be drawn.</span>}</div>}
  </div>
}

function Lyrics({ clip, time, playing }) {
  const [follow, setFollow] = useState(true)
  const scroller = useRef(null)
  const segments = useMemo(() => lyricSegments(clip), [clip.id])
  const current = activeLyric(segments, time)
  const timed = segments.some((segment) => segment.time !== null)
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [clip.id])
  useEffect(() => {
    if (!follow || !playing || current < 0) return
    const pane = scroller.current
    const target = pane?.querySelector('[data-current="true"]')
    if (!target) return
    const bounds = pane.getBoundingClientRect()
    const line = target.getBoundingClientRect()
    if (line.top < bounds.top + 32 || line.bottom > bounds.bottom - 32) {
      const top = pane.scrollTop + line.top - bounds.top - Math.min(80, pane.clientHeight / 4)
      pane.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }, [current, follow, playing])
  return <section class="booklet" aria-labelledby="lyrics-heading">
    <div class="booklet-heading">
      <div><span class="eyebrow">THE WORDS INSIDE</span><h2 id="lyrics-heading">Liner notes<span class="red-dot">.</span></h2></div>
      {timed && <button class={`follow-button ${follow ? 'enabled' : ''}`} aria-pressed={follow} onClick={() => setFollow(!follow)}><span class="follow-dot" />Follow</button>}
    </div>
    <div class="lyric-status"><span>{timed ? 'TIMED FROM YOUR EXPORT' : 'UNTIMED LYRICS'}</span><span>{timed ? 'Highlights follow the saved markers' : 'Read at your own pace'}</span></div>
    <div class="lyric-scroller" ref={scroller} tabIndex="0" role="region" aria-label={`Lyrics for ${clip.title}`}>
      {segments.length ? <div class={`lyric-text ${timed ? 'timed' : ''}`}>
        {segments.map((segment, index) => <span key={index} class={`lyric-fragment ${current === index ? 'current' : ''}`} data-current={current === index && timed ? 'true' : undefined}>{segment.text}</span>)}
      </div> : <div class="no-lyrics"><Music2 size={32} strokeWidth={1.5} /><h3>Let the music speak.</h3><p>No lyrics were included for this pressing.</p></div>}
    </div>
    <div class="booklet-footer"><span>PERSONAL PRESSING / {clip.id.slice(0, 8).toUpperCase()}</span><span>{timed ? `${segments.filter((segment) => segment.time !== null).length} timing markers` : 'Words from your archive'}</span></div>
  </section>
}

export function App() {
  const [clips, setClips] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [ready, setReady] = useState(false)
  const [audioError, setAudioError] = useState('')
  const audio = useRef(null)
  const playOnSelect = useRef(false)
  const searchInput = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    fetch(`${import.meta.env.BASE_URL}songs.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load songs.json (HTTP ${response.status}).`)
        return response.json()
      })
      .then((data) => {
        const library = readLibrary(data)
        setClips(library)
        setSelectedId(filterLibrary(library, '', 'all', 'newest')[0]?.id ?? '')
        setLoading(false)
      })
      .catch((error) => {
        if (error.name !== 'AbortError') { setLoadError(error.message); setLoading(false) }
      })
    return () => controller.abort()
  }, [attempt])

  const results = useMemo(() => filterLibrary(clips, query, filter, sort), [clips, query, filter, sort])
  const selected = clips.find((clip) => clip.id === selectedId)
  const pages = Math.ceil(results.length / PAGE_SIZE)
  const visible = results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0)
  const favorites = clips.filter((clip) => clip.is_favorite).length
  const timedCount = clips.filter((clip) => clip.hasTiming).length

  useEffect(() => setPage(0), [query, filter, sort])
  useEffect(() => {
    const element = audio.current
    if (!element || !selected) return
    element.pause()
    element.load()
    setTime(0)
    setDuration(selected.durationSeconds)
    setReady(false)
    setAudioError('')
    if (playOnSelect.current && selected.audioUrl) startPlayback()
    playOnSelect.current = false
  }, [selectedId])
  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume])

  function startPlayback() {
    const element = audio.current
    if (!element?.src) return
    const source = element.src
    setAudioError('')
    element.play().catch((error) => {
      if (error.name !== 'AbortError' && element.src === source) setAudioError('Playback could not start. Try again or open the M4A link.')
    })
  }
  function choose(clip, start = true) {
    if (clip.id === selectedId) {
      if (start) playing ? audio.current.pause() : startPlayback()
      return
    }
    playOnSelect.current = start
    setSelectedId(clip.id)
  }
  function step(direction, start = playing) {
    const playable = results.filter((clip) => clip.audioUrl)
    if (!playable.length) return
    const current = playable.findIndex((clip) => clip.id === selectedId)
    const index = current < 0 ? 0 : (current + direction + playable.length) % playable.length
    choose(playable[index], start)
  }
  function surprise() {
    const playable = results.filter((clip) => clip.audioUrl && clip.id !== selectedId)
    if (playable.length) choose(playable[Math.floor(Math.random() * playable.length)])
    else if (selected?.audioUrl) startPlayback()
  }
  function seek(value) {
    if (!audio.current || !ready) return
    audio.current.currentTime = Number(value)
    setTime(Number(value))
  }

  return <>
    <a class="skip-link" href="#collection">Skip to the collection</a>
    <header class="masthead">
      <a class="wordmark" href={import.meta.env.BASE_URL} aria-label="Sleeve Notes home"><Disc3 size={36} strokeWidth={1.4} /><span>SLEEVE<br /><strong>NOTES</strong></span></a>
      <div class="masthead-center">A PERSONAL MUSIC ARCHIVE<span />IN GOOD COMPANY</div>
      <button class="surprise-button" onClick={surprise} disabled={loading || !results.some((clip) => clip.audioUrl)}><Shuffle size={17} /><span>Surprise me</span><ArrowRight size={16} /></button>
    </header>

    <main class="listening-room">
      <section class="intro" aria-labelledby="page-heading">
        <div><div class="eyebrow"><span class="red-dot">●</span> YOUR SOUND, ON THE RECORD</div><h1 id="page-heading">A room for<br /><em>your records.</em></h1></div>
        <div class="archive-note"><span class="archive-number">{loading ? '…' : clips.length.toLocaleString()}</span><div><span class="eyebrow">PERSONAL PRESSINGS</span><p>Every strange idea. Every good chorus.<br />All here, waiting for another listen.</p><span class="archive-runtime">{Math.floor(totalSeconds / 3600)}h {Math.floor((totalSeconds % 3600) / 60)}m of your music <span>/</span> {timedCount} with timed lyrics</span></div></div>
      </section>

      {loadError ? <section class="library-state" role="alert"><Disc3 size={40} /><h2>The crate didn't open.</h2><p>{loadError}</p><p>Place your full export at <code>viewer/public/songs.json</code>.</p><button class="text-button" onClick={() => setAttempt(attempt + 1)}><RefreshCw size={16} />Try again</button></section>
        : loading ? <section class="loading-layout" aria-busy="true" aria-label="Loading your music archive"><div class="loading-caption"><LoaderCircle class="loading-spinner" size={20} />Opening the record crate…</div><div class="loading-columns"><div class="skeleton" /><div class="skeleton" /><div class="skeleton" /></div></section>
          : !clips.length ? <section class="library-state"><Disc3 size={48} strokeWidth={1} /><h2>Your first pressing belongs here.</h2><p>No clips were found in songs.json. Export your songs, then refresh.</p></section>
            : <div class="room-grid">
              <section class="collection" id="collection" aria-labelledby="collection-heading">
                <div class="section-heading"><div><span class="eyebrow">01 / THE COLLECTION</span><h2 id="collection-heading">Dig a little.</h2></div><span class="collection-total">{clips.length}</span></div>
                <label class="search-field"><Search size={18} /><span class="sr-only">Search titles, lyrics, or generation prompts</span><input ref={searchInput} type="search" value={query} placeholder="A title, a lyric, a feeling…" onInput={(event) => setQuery(event.currentTarget.value)} />{query && <button aria-label="Clear search" onClick={() => { setQuery(''); searchInput.current.focus() }}><X size={16} /></button>}</label>
                <div class="crate-filters" aria-label="Filter collection">
                  {[['all', 'All records', clips.length], ['favorites', 'Favorites', favorites], ['timed', 'Timed', timedCount]].map(([value, label, count]) => <button key={value} class={filter === value ? 'selected' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'favorites' && <Heart size={12} />} {label}<span>{count}</span></button>)}
                </div>
                <div class="crate-tools"><span aria-live="polite">{results.length} {results.length === 1 ? 'pressing' : 'pressings'}</span><label class="sort-control"><span class="sr-only">Sort records</span><select value={sort} onChange={(event) => setSort(event.currentTarget.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A to Z</option><option value="longest">Longest first</option></select><ChevronDown size={13} /></label></div>
                <div class="crate-scroll">
                  {results.length ? <ol class="track-list" start={page * PAGE_SIZE + 1}>
                    {visible.map((clip, index) => <li key={clip.id}><button class={`track-row ${selectedId === clip.id ? 'current' : ''}`} aria-label={`${selectedId === clip.id && playing ? 'Pause' : 'Play'} ${clip.title}, ${clock(clip.durationSeconds)}`} aria-pressed={selectedId === clip.id} onClick={() => choose(clip)}>
                      <span class="track-number">{selectedId === clip.id ? (playing ? <span class="playing-bars" aria-hidden="true"><i /><i /><i /></span> : <Play size={13} fill="currentColor" />) : String(page * PAGE_SIZE + index + 1).padStart(2, '0')}</span>
                      <Cover clip={clip} small /><span class="track-copy"><span class="track-title">{clip.title}</span><span class="track-subtitle">{dateLabel(clip.created_at)}{clip.is_favorite && <Heart size={10} fill="currentColor" />}</span></span><span class="track-duration">{clock(clip.durationSeconds)}</span>
                    </button></li>)}
                  </ol> : <div class="empty-crate"><Search size={26} strokeWidth={1.5} /><h3>Nothing in this corner.</h3><p>Try another lyric or loosen the filter.</p><button class="text-button" onClick={() => { setQuery(''); setFilter('all') }}>Show all records<ArrowRight size={15} /></button></div>}
                </div>
                <div class="crate-pagination"><span>{results.length ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, results.length)} of ${results.length}` : 'No matches'}</span><div><button aria-label="Previous page" disabled={page <= 0} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button><span>{pages ? page + 1 : 0} / {pages}</span><button aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button></div></div>
                <div class="crate-note"><ListMusic size={16} /><p>Search the words, not just the title.<br />The whole archive is in your crate.</p></div>
              </section>

              {selected && <div class="open-sleeve" aria-label="Selected pressing">
                <section class="sleeve" aria-labelledby="pressing-title">
                  <div class="sleeve-topline"><span class="eyebrow">02 / ON THE TURNTABLE</span><span class="pressing-stamp">M4A / {selected.id.slice(0, 8)}</span></div>
                  <div class="sleeve-art"><Cover clip={selected} /><span class="art-label"><Disc3 size={14} />PERSONAL PRESSING</span></div>
                  <div class="pressing-meta"><span>{dateLabel(selected.created_at)}</span><span>{clock(selected.durationSeconds)}<span class="meta-divider">/</span>{selected.privacy || 'Privacy unspecified'}</span></div>
                  <h2 id="pressing-title">{selected.title}</h2>
                  <div class="sleeve-actions"><button class="pressing-play" disabled={!selected.audioUrl} onClick={() => playing ? audio.current.pause() : startPlayback()}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}<span>{playing ? 'Pause this pressing' : 'Play this pressing'}</span></button>{selected.is_favorite && <span class="favorite-stamp" title="Favorite in your Flow export"><Heart size={16} fill="currentColor" /><span class="sr-only">Favorite in your Flow export</span></span>}</div>
                  {audioError && <p class="audio-error" role="alert">{audioError}</p>}
                  <div class="file-links"><span class="eyebrow">KEEP A COPY</span>{selected.audioUrl && <a href={selected.audioUrl} target="_blank" rel="noopener noreferrer"><ArrowDownToLine size={14} />M4A</a>}{selected.wavUrl && <a href={selected.wavUrl} target="_blank" rel="noopener noreferrer"><ArrowDownToLine size={14} />WAV</a>}</div>
                  <details class="generation-notes" key={`notes-${selected.id}`}><summary><span><span class="eyebrow">BEHIND THE SOUND</span><strong>Generation notes</strong></span><ChevronDown size={18} /></summary><p>{selected.prompt || 'No sound prompt included in this export.'}</p><dl><div><dt>Created</dt><dd>{dateLabel(selected.created_at)}</dd></div><div><dt>Operation</dt><dd>{selected.operation?.op_type || selected.op_type || 'Not provided'}</dd></div><div><dt>Plays in export</dt><dd>{selected.play_count ?? 'Not provided'}</dd></div><div><dt>Public use</dt><dd>{typeof selected.allow_public_use === 'boolean' ? selected.allow_public_use ? 'Allowed' : 'Not allowed' : 'Not specified'}</dd></div><div><dt>Clip ID</dt><dd>{selected.id}</dd></div></dl></details>
                  <details class="raw-data" key={`raw-${selected.id}`}><summary>All exported metadata<ArrowRight size={14} /></summary><pre>{JSON.stringify(selected.raw, null, 2)}</pre></details>
                </section>
                <Lyrics clip={selected} time={time} playing={playing} />
              </div>}
            </div>}
      <footer class="room-footer"><span>SLEEVE NOTES</span><span>Yours to make. Yours to keep.</span><span>Read directly from songs.json<Check size={12} /></span></footer>
    </main>

    <audio ref={audio} src={selected?.audioUrl || undefined} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { const value = event.currentTarget.duration; setDuration(Number.isFinite(value) ? value : selected?.durationSeconds || 0); setReady(true) }} onEnded={() => step(1, true)} onError={() => { if (selected?.audioUrl) { setPlaying(false); setAudioError('This audio could not be loaded. Try the M4A link or another pressing.') } }} />
    {selected && !loading && !loadError && <section class="player" aria-label="Music player">
      <div class="player-track"><Cover clip={selected} small /><div><strong>{selected.title}</strong><span>{playing ? 'ON THE TURNTABLE' : 'READY WHEN YOU ARE'}<span class="player-status-dot" /></span></div></div>
      <div class="player-main"><div class="transport"><button aria-label="Previous track" onClick={() => step(-1)} disabled={!results.some((clip) => clip.audioUrl)}><SkipBack size={18} fill="currentColor" /></button><button class="player-play" aria-label={playing ? 'Pause' : 'Play'} disabled={!selected.audioUrl} onClick={() => playing ? audio.current.pause() : startPlayback()}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button aria-label="Next track" onClick={() => step(1)} disabled={!results.some((clip) => clip.audioUrl)}><SkipForward size={18} fill="currentColor" /></button></div><div class="seek-bar"><span>{clock(time)}</span><label><span class="sr-only">Seek audio</span><input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time, duration || 0)} disabled={!ready} onInput={(event) => seek(event.currentTarget.value)} style={{ '--range-fill': `${duration ? Math.min(100, time / duration * 100) : 0}%` }} aria-valuetext={`${clock(time)} of ${clock(duration)}`} /></label><span>{clock(duration)}</span></div></div>
      <div class="player-extras"><button class="volume-toggle" aria-label={volume ? 'Mute' : 'Unmute'} onClick={() => setVolume(volume ? 0 : 0.8)}>{volume ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><label class="volume-range"><span class="sr-only">Volume</span><input type="range" min="0" max="1" step="0.01" value={volume} onInput={(event) => setVolume(Number(event.currentTarget.value))} style={{ '--range-fill': `${volume * 100}%` }} /></label><span class="player-format">M4A<br /><small>ORIGINAL AUDIO</small></span></div>
    </section>}
  </>
}
