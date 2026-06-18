// RECOVERED verbatim from original Emergent app sourcemap (flexi-cap-labs.preview.emergentagent.com)
// Reference only — defines exact theme, layout, typography, header/footer/tabs.
import "@/App.css";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import SingleMonthView from "@/components/SingleMonthView";
import CompareMonthsView from "@/components/CompareMonthsView";
import { ChartLine, Stack, GitDiff } from "@phosphor-icons/react";

function App() {
  return (
    <div className="App min-h-screen bg-[#050505] text-white">
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#0A0A0C",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 0,
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 12,
            color: "#fafafa",
          },
        }}
      />

      {/* Header */}
      <header className="border-b border-white/10 bg-[#050505] sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#EAB308] flex items-center justify-center">
              <ChartLine size={18} weight="bold" className="text-[#050505]" />
            </div>
            <div className="leading-none">
              <div className="font-display font-black text-base tracking-tight text-white">
                PPFAS · FACTSHEET ANALYSER
              </div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-mono mt-1">
                Parag Parikh Flexi Cap · monthly research desk
              </div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-[#22C55E]" />
              live
            </span>
            <span>v 1.0</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8 md:py-10">
        {/* Hero */}
        <section className="mb-8 md:mb-10">
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-none text-white">
            Read a factsheet.
            <br />
            <span className="text-[#EAB308]">In 30 seconds.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-sm md:text-base text-zinc-400 font-mono leading-relaxed">
            Drop the monthly PPFAS Flexi Cap PDF. Get the portfolio,
            category mix, deployable cash, and month-on-month deltas —
            without spreadsheets.
          </p>
        </section>

        <Tabs defaultValue="single" className="w-full">
          <TabsList
            className="bg-transparent border-b border-white/10 w-full justify-start gap-0 h-auto p-0 rounded-none mb-6"
            data-testid="tabs-list"
          >
            <TabsTrigger
              value="single"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#EAB308] data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none font-mono uppercase tracking-[0.2em] text-xs px-5 py-4 text-zinc-500 hover:text-zinc-200 transition-colors"
              data-testid="tab-single"
            >
              <Stack size={14} weight="bold" className="mr-2" />
              Analyse One Month
            </TabsTrigger>
            <TabsTrigger
              value="compare"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#EAB308] data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none font-mono uppercase tracking-[0.2em] text-xs px-5 py-4 text-zinc-500 hover:text-zinc-200 transition-colors"
              data-testid="tab-compare"
            >
              <GitDiff size={14} weight="bold" className="mr-2" />
              Compare Two Months
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-0">
            <SingleMonthView />
          </TabsContent>
          <TabsContent value="compare" className="mt-0">
            <CompareMonthsView />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-white/10 mt-12 py-6">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
          <span>Built for serious investors · No login · No data stored</span>
          <span>Not investment advice · Verify against official factsheet</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
