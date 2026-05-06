export const dynamic = "force-static";

export default function SobrePage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-32 text-zinc-100 sm:px-10">
      <section className="mx-auto max-w-4xl">
        <p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-amber-300">
          Sobre
        </p>
        <h1 className="mt-6 [font-family:var(--font-serif)] text-5xl leading-none text-zinc-50 sm:text-7xl">
          Uma leitura histórica do trabalho em Portugal.
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-8 text-zinc-400">
          PRISMA cruza dados recolhidos via Arquivo.pt com análise visual para revelar
          como o mercado de trabalho português mudou ao longo de quase duas décadas.
        </p>
      </section>
    </main>
  );
}
