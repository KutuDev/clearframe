import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { detectCapabilities, supportedMedia } from '../lib/capabilities';
import { DenoiseJob, type JobProgress } from '../lib/jobs';

const empty: JobProgress = { stage: 'idle', value: 0, message: 'Nothing leaves this device.' };
const formatBytes = (bytes: number) => bytes < 1024 ** 2 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function App() {
  const capability = useMemo(detectCapabilities, []);
  const [file, setFile] = useState<File>();
  const [progress, setProgress] = useState<JobProgress>(empty);
  const job = useRef<DenoiseJob | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const choose = (selected?: File) => {
    if (!selected) return;
    job.current?.dispose(); setProgress(empty); setFile(selected);
  };
  const onFile = (event: ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0]);
  const start = () => {
    if (!file) return;
    job.current?.dispose();
    job.current = new DenoiseJob(setProgress);
    job.current.start(file);
  };
  const busy = ['checking', 'preparing', 'enhancing', 'packaging'].includes(progress.stage);
  const fileOkay = !!file && supportedMedia(file);
  return <main className="shell">
    <nav><span className="brand-mark" aria-hidden>◒</span><span className="brand">ClearFrame</span><span className="private">On-device processing</span></nav>
    <section className="hero">
      <p className="kicker">VOICE CLEANUP</p>
      <h1>Make the voice<br /><em>the only thing heard.</em></h1>
      <p className="lede">Neural cleanup for spoken audio and video. Private by design, with your original video kept exactly as it is.</p>
    </section>
    <section className="panel" aria-label="Denoise job">
      {!file ? <button className="drop" onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>
        <span className="drop-icon">↓</span><strong>Choose a recording</strong><small>MP4, M4A, or WAV · up to 500 MB</small>
      </button> : <div className="selected"><div className="file-icon">{file.name.endsWith('.mp4') ? 'VIDEO' : 'AUDIO'}</div><div><strong>{file.name}</strong><small>{formatBytes(file.size)} · processed locally</small></div><button className="quiet" onClick={() => { setFile(undefined); setProgress(empty); }}>Replace</button></div>}
      <input ref={input} className="visually-hidden" type="file" accept=".mp4,.m4a,.wav,video/mp4,audio/mp4,audio/wav" onChange={onFile} />
      {file && !fileOkay && <p className="error">Use MP4, M4A, or WAV files no larger than 500 MB.</p>}
      {progress.stage === 'idle' && <div className="profile"><span className="spark">✦</span><div><strong>Neural voice cleanup</strong><small>DeepFilterNet profile · restores safe program level</small></div><span>Default</span></div>}
      {progress.stage !== 'idle' && <div className={`progress ${progress.stage}`}><div className="progress-copy"><span>{progress.stage === 'error' ? 'Needs attention' : progress.stage === 'complete' ? 'Ready to download' : progress.stage}</span><strong>{progress.message}</strong></div>{busy && <><div className="track"><i style={{ width: `${progress.value}%` }} /></div><button className="quiet" onClick={() => job.current?.cancel()}>Cancel</button></>}{progress.output && <button className="download" onClick={() => { const url = URL.createObjectURL(progress.output!); Object.assign(document.createElement('a'), { href: url, download: progress.output!.name }).click(); setTimeout(() => URL.revokeObjectURL(url), 1_000); }}>Download enhanced file</button>}{progress.error && <p className="error">{progress.error}</p>}</div>}
      <button className="primary" disabled={!fileOkay || busy || !capability.supported} onClick={start}>{busy ? 'Working locally…' : 'Enhance recording'}</button>
      {!capability.supported && <p className="error">This app requires a current version of Chrome or Edge with private local storage enabled.</p>}
    </section>
    <section className="assurance"><div><b>Private</b><span>Your file never uploads.</span></div><div><b>Unchanged video</b><span>Video packets are copied, never re-encoded.</span></div><div><b>One clear result</b><span>High-quality MP4, ready to share.</span></div></section>
  </main>;
}
