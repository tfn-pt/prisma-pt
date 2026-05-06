"use client";

import { AnimatePresence, motion, useMotionValue, type PanInfo } from "framer-motion";
import { Bot, Grip, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = { role: "bot" | "user"; text: string };

type ChatbotProps = {
  defaultOpen?: boolean;
  embedded?: boolean;
  launcherHidden?: boolean;
  onClose?: () => void;
};

const premiumMotion = "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";
const premiumHover = "hover:scale-[1.02] hover:bg-white/10 hover:text-white hover:[text-shadow:0_0_18px_rgba(255,255,255,0.28)]";

const QUICK_PROMPTS = [
  "O que é o PRISMA?",
  "Vulnerabilidade",
  "Troika 2012",
  "Pandemia",
  "Setor IT",
  "Precariedade criativa",
];

function getBotReply(input: string): string {
  const q = input.toLowerCase();

  if (/o que .*(prisma)|prisma|quem (és|es)|projeto/.test(q)) {
    return "O PRISMA é uma lente sobre a memória laboral portuguesa: resgata 20.416 anúncios perdidos do Arquivo.pt e transforma vestígios efémeros em uma cartografia viva de 17 anos de trabalho. Não é só um dashboard; é preservação cívica, análise económica e design de dados ao serviço da memória.";
  }
  if (/vulnerabilidade|precariedade|precario|precário|estagio|estágio/.test(q)) {
    return "O Índice de Vulnerabilidade PRISMA combina sinais de estágio, senioridade fraca e linguagem laboral ambígua. Design & Criativo surge como altamente exposto porque concentra cerca de 11% de anúncios de estágio: muita porta de entrada, pouca estabilidade. IT, em contraste, tende a oferecer maior senioridade, vocabulário técnico mais específico e procura mais contínua.";
  }
  if (/crise|troika|austeridade|2012|2013|2014|emigra/.test(q)) {
    return "No ciclo 2012-2014, a leitura é severa: a Construção perde centralidade, os setores físicos contraem e a emigração transforma-se numa válvula de sobrevivência. O PRISMA mostra a austeridade não como abstração macroeconómica, mas como desaparecimento de oportunidades concretas no arquivo.";
  }
  if (/pandemia|covid|2020|2021|confinamento|hospitalidade|turismo/.test(q)) {
    return "A pandemia abre uma fratura limpa na série temporal: Restauração & Hotelaria colapsa em 2020-2021, enquanto logística, suporte remoto e IT ganham peso relativo. A recuperação posterior existe, mas vem em forma de boom assimétrico: turismo regressa depressa, porém com maior volatilidade e pressão sobre trabalho presencial.";
  }
  if (/\bit\b|tecnologia|tech|programador|developer|software|cloud|dados/.test(q)) {
    return "IT é a força gravitacional do período 2016-2019. Deixa de aparecer apenas como nicho técnico e passa a engolir a linguagem do mercado: developer, data, cloud, suporte e produto. A estabilidade relativa vem da procura contínua, da senioridade mais explícita e da capacidade de atravessar crises com trabalho remoto.";
  }
  if (/fonte|dados|arquivo|snapshot|crawl/.test(q)) {
    return "A base vem do Arquivo.pt: anúncios de emprego preservados entre 2008 e 2024. O PRISMA agrega snapshots, remove duplicados e normaliza título, localização, categoria, período histórico e marcadores de vulnerabilidade.";
  }
  if (/pipeline|nlp|classific|modelo|bert|ia/.test(q)) {
    return "O pipeline combina extração estrutural, limpeza lexical e classificação híbrida. Termos profissionais resolvem casos evidentes; títulos ambíguos seguem para comparação semântica por categoria. Depois, o PRISMA calcula sinais como género, estágio, senioridade e localização.";
  }
  if (/mapa|distrito|geograf|local/.test(q)) {
    return "O mapa agrega localidades a distritos. Lisboa e Porto concentram a maior parte do arquivo, mas Faro, Braga, Setubal e Aveiro revelam mudancas setoriais importantes quando se muda o periodo.";
  }
  if (/colaborador|palavra|titulo|linguagem/.test(q)) {
    return "Colaborador é um sinal linguístico forte: cresce quando o cargo fica menos específico. No arquivo, funciona como proxy de anúncios que suavizam função, senioridade ou condições. É uma palavra simpática; analiticamente, muitas vezes é nevoeiro.";
  }
  if (/genero|g[eé]nero|m\/f|linguagem/.test(q)) {
    return "O marcador de género aparece em cerca de um terço dos anúncios. A sua queda ao longo do tempo mostra mudanças culturais, legais e de linguagem inclusiva no recrutamento. O PRISMA trata este sinal com cuidado porque as datas de crawl podem criar oscilações artificiais.";
  }

  return "Posso cruzar metodologia, períodos históricos, geografia, categorias profissionais, linguagem e vulnerabilidade. Pergunta-me por PRISMA, Troika, pandemia, IT, precariedade, género, colaborador ou distritos.";
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-500">
      <span className="font-mono text-[0.62rem] tracking-widest uppercase">a processar</span>
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="inline-block h-1 w-1 rounded-full bg-amber-300"
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: index * 0.14 }}
        />
      ))}
    </span>
  );
}

export default function Chatbot({
  defaultOpen = false,
  embedded = false,
  launcherHidden = false,
  onClose,
}: ChatbotProps = {}) {
  const [open, setOpen] = useState(defaultOpen);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleDismissed, setBubbleDismissed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelDir, setPanelDir] = useState<"up" | "down">("up");
  const [pos, setPos] = useState({ left: 24, bottom: 24 });
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "bot",
      text: "Estou ligada ao PRISMA, a lente analítica do mercado de trabalho português. Pergunta por metodologia, vulnerabilidade, Troika, pandemia, IT, distritos ou pela evolução de uma profissão.",
    },
  ]);

  const motionX = useMotionValue(0);
  const motionY = useMotionValue(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMounted(true);
      try {
        const saved = localStorage.getItem("atlas-bot-pos");
        if (saved) setPos(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (launcherHidden || open || bubbleDismissed || !mounted) return;
    const show = window.setTimeout(() => setShowBubble(true), 2200);
    const hide = window.setTimeout(() => setShowBubble(false), 7200);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [launcherHidden, open, bubbleDismissed, mounted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 240);
  }, [open]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isTyping) return;
      setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
      setInput("");
      setIsTyping(true);
      window.setTimeout(() => {
        setMessages((prev) => [...prev, { role: "bot", text: getBotReply(trimmed) }]);
        setIsTyping(false);
      }, 760 + Math.random() * 280);
    },
    [isTyping],
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const button = 64;
      const margin = 12;
      const next = {
        left: Math.max(margin, Math.min(vw - button - margin, pos.left + info.offset.x)),
        bottom: Math.max(margin, Math.min(vh - button - margin, pos.bottom - info.offset.y)),
      };

      setPos(next);
      setPanelDir(vh - next.bottom - button < vh * 0.44 ? "down" : "up");
      motionX.set(0);
      motionY.set(0);
      try {
        localStorage.setItem("atlas-bot-pos", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      window.setTimeout(() => setIsDragging(false), 80);
    },
    [motionX, motionY, pos],
  );

  if (!mounted) return null;

  const panelOffsetClass = panelDir === "up" ? "bottom-full mb-4" : "top-full mt-4";
  const panelClass = embedded
    ? "system-panel pointer-events-auto absolute bottom-full right-0 mb-4 flex h-[min(36rem,calc(100vh-8rem))] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden"
    : `system-panel pointer-events-auto absolute ${panelOffsetClass} flex h-[min(36rem,calc(100vh-8rem))] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden`;
  const closeChatbot = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <motion.div
      drag={!embedded}
      dragMomentum={false}
      dragElastic={0.04}
      style={
        embedded
          ? { position: "fixed", right: 20, bottom: 20, zIndex: 9999 }
          : { position: "fixed", left: pos.left, bottom: pos.bottom, x: motionX, y: motionY, zIndex: 9999 }
      }
      onDragStart={() => {
        if (!embedded) setIsDragging(true);
      }}
      onDragEnd={embedded ? undefined : handleDragEnd}
      className="select-none"
      whileDrag={{ scale: 1.03 }}
    >
      <AnimatePresence>
        {showBubble && !open && !launcherHidden ? (
          <motion.div
            initial={{ opacity: 0, y: panelDir === "up" ? 10 : -10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            onHoverStart={() => setShowBubble(true)}
            className={`pointer-events-auto absolute ${panelOffsetClass} w-72`}
          >
            <div className="system-panel relative p-4">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowBubble(false);
                  setBubbleDismissed(true);
                }}
                className={`absolute -right-2 -top-2 grid h-6 w-6 place-items-center border border-white/10 bg-zinc-950 text-zinc-500 ${premiumMotion} ${premiumHover}`}
                aria-label="Fechar"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-300" />
                <span className="font-mono text-[0.62rem] font-black uppercase tracking-[0.24em] text-amber-200">CASSANDRA</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-200">Pergunta-me pelo arquivo, pelos setores ou por uma profissao.</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: panelDir === "up" ? 16 : -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: panelDir === "up" ? 8 : -8 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className={panelClass}
          >
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <div className="relative grid h-9 w-9 place-items-center border border-amber-300/40 bg-amber-300/10 text-amber-200">
                <Bot className="h-4 w-4" />
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-zinc-950 bg-emerald-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[0.7rem] font-black uppercase tracking-[0.22em] text-zinc-100">CASSANDRA</p>
                <p className="truncate font-mono text-[0.56rem] uppercase tracking-[0.12em] text-zinc-600">Arquivo.pt / 2008-2024 / mercado laboral</p>
              </div>
              <Grip className="h-4 w-4 text-zinc-700" aria-hidden />
              <button type="button" onClick={closeChatbot} className={`p-1 text-zinc-500 ${premiumMotion} ${premiumHover}`} aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-white/10 p-3">
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => sendMessage(prompt)}
                    disabled={isTyping}
                    className={`system-control shrink-0 px-2.5 py-1.5 font-mono text-[0.56rem] font-black uppercase tracking-[0.12em] disabled:opacity-40 ${premiumMotion} ${premiumHover}`}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]">
              <AnimatePresence initial={false}>
                {messages.map((message, index) => (
                  <motion.div
                    key={`${message.role}-${index}`}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.22 }}
                    className={`max-w-[88%] px-3 py-2.5 text-sm leading-6 ${
                      message.role === "user"
                        ? "ml-auto border border-amber-300/30 bg-amber-300/[0.08] text-amber-50"
                        : "border border-white/10 bg-white/[0.04] text-zinc-300"
                    }`}
                  >
                    {message.text}
                  </motion.div>
                ))}
              </AnimatePresence>
              {isTyping ? (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="max-w-[88%] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm">
                  <ThinkingDots />
                </motion.div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <form
              className="flex items-center gap-2 border-t border-white/10 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Pergunta por IT, COVID, genero..."
                className={`min-w-0 flex-1 border border-white/10 bg-zinc-950 px-3 py-2.5 font-mono text-[0.74rem] text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-amber-300/60 ${premiumMotion} focus:scale-[1.01] focus:bg-white/[0.035]`}
              />
              <button type="submit" className={`grid h-10 w-10 place-items-center border border-amber-300/50 text-amber-200 ${premiumMotion} hover:scale-[1.02] hover:bg-white/10 hover:text-white hover:[text-shadow:0_0_18px_rgba(255,255,255,0.28)]`} aria-label="Enviar">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!launcherHidden ? (
      <motion.button
        type="button"
        onClick={() => {
          if (isDragging) return;
          setOpen((value) => !value);
          setShowBubble(false);
        }}
        onHoverStart={() => {
          if (!open && !bubbleDismissed) setShowBubble(true);
        }}
        onHoverEnd={() => {
          if (!open && !bubbleDismissed) window.setTimeout(() => setShowBubble(false), 1800);
        }}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.92 }}
        className={`pointer-events-auto relative grid h-16 w-16 place-items-center rounded-full border border-amber-300/60 bg-zinc-950 text-amber-100 shadow-2xl shadow-amber-950/50 ${premiumMotion} hover:scale-[1.02] hover:bg-white/10 hover:text-white hover:[text-shadow:0_0_18px_rgba(255,255,255,0.28)]`}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
        aria-label={open ? "Fechar chatbot" : "Abrir chatbot"}
      >
        {!open ? (
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-full border border-amber-300/60"
            animate={{ scale: [1, 1.55], opacity: [0.65, 0] }}
            transition={{ duration: 2.1, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span key="x" initial={{ rotate: -80, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 80, opacity: 0 }}>
              <X className="h-6 w-6" />
            </motion.span>
          ) : (
            <motion.span key="chat" initial={{ rotate: 80, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -80, opacity: 0 }}>
              <MessageCircle className="h-7 w-7" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      ) : null}
    </motion.div>
  );
}
