import { Link } from 'react-router-dom';
import { useAuth } from '../../app/AuthProvider';
import { buttonClasses } from '../../components/ui/Button';
import { Logo } from '../../components/ui/Logo';

const features = [
  {
    title: 'Record once, rough is fine',
    body: 'Capture your screen and voice straight from the browser. Stumbles, pauses and "um"s are expected — we clean them up later.',
  },
  {
    title: 'A script that sounds rehearsed',
    body: 'Your narration is transcribed and rewritten into a tight, friendly script, split into timed segments you can edit line by line.',
  },
  {
    title: 'Studio-quality voiceover',
    body: 'Pick a natural AI voice and regenerate any single line without re-recording the whole thing.',
  },
  {
    title: 'Zooms that follow your clicks',
    body: 'Click positions captured while you record become smooth zoom and spotlight effects that guide the viewer’s eye.',
  },
  {
    title: 'Docs written for you',
    body: 'Turn the same recording into a step-by-step guide with screenshots, ready to paste into your help center.',
  },
  {
    title: 'Speak every language',
    body: 'Translate scripts, captions and on-screen text, then re-voice the video so every customer hears their own language.',
  },
];

const steps = [
  { n: '1', title: 'Capture', body: 'Record your screen, upload a video, drop in slides, or just describe what you need.' },
  { n: '2', title: 'Refine', body: 'OpenClue drafts the script, voiceover, captions and zooms. Tweak anything on the timeline.' },
  { n: '3', title: 'Publish', body: 'Export an MP4 or GIF, plus a matching how-to article in Markdown, HTML or PDF.' },
];

export function LandingPage() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo className="text-lg text-slate-900" />
        <nav className="flex items-center gap-2">
          {user ? (
            <Link to="/app" className={buttonClasses('primary')}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/signin" className={buttonClasses('ghost')}>
                Sign in
              </Link>
              <Link to="/signup" className={buttonClasses('primary')}>
                Get started free
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-600">Open-source product video studio</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
            From messy screen recording to polished product video in minutes
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            OpenClue takes your rough walkthroughs, slide decks, documents or a simple prompt and turns them into
            crisp explainer videos and step-by-step guides — with a clean script, a natural voice, captions and
            smart zooms included.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className={buttonClasses('primary', 'px-6 py-3 text-base')}>
              Make your first video
            </Link>
            <a href="#how-it-works" className={buttonClasses('secondary', 'px-6 py-3 text-base')}>
              See how it works
            </a>
          </div>
        </section>

        <section className="bg-slate-50 py-20" aria-labelledby="features-heading">
          <div className="mx-auto max-w-6xl px-6">
            <h2 id="features-heading" className="text-center text-3xl font-bold tracking-tight text-slate-900">
              Everything a product team needs to explain itself
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                  <h3 className="font-semibold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-20" aria-labelledby="how-heading">
          <div className="mx-auto max-w-5xl px-6">
            <h2 id="how-heading" className="text-center text-3xl font-bold tracking-tight text-slate-900">
              Three steps, no editing degree required
            </h2>
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n} className="text-center">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 font-bold text-white">
                    {s.n}
                  </span>
                  <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-indigo-600 py-16 text-center text-white">
          <h2 className="text-3xl font-bold tracking-tight">Ship the video your feature deserves</h2>
          <p className="mx-auto mt-3 max-w-xl text-indigo-100">
            Start free, self-host if you like, and keep every file you create.
          </p>
          <Link to="/signup" className={buttonClasses('secondary', 'mt-8 px-6 py-3 text-base')}>
            Create a free account
          </Link>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500">
        © {new Date().getFullYear()} OpenClue contributors · Open source under the MIT license
      </footer>
    </div>
  );
}
