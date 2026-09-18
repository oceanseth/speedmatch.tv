import Link from "next/link";
import Header from "../../../components/Header";
export default function NotFound() {
  return <><Header /><main className="mx-auto w-full max-w-3xl flex-1 px-4 py-20"><p className="text-xs font-bold uppercase tracking-widest text-brand-pink">Recap unavailable</p><h1 className="mt-4 text-3xl font-bold">This show isn’t available to watch.</h1><p className="mt-4 text-muted">Only finished, public tournaments have a recap.</p><Link href="/#recent-shows-title" className="mt-6 inline-block text-brand-pink">Explore recent shows →</Link></main></>;
}
