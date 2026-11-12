// ui/components/confetti.js — конфетти на canvas без библиотек.
// Усиленная версия: два «залпа» с боков, затем падающий дождь из
// 220 частиц (прямоугольники, кружки, ленты) в цветах сигналов
// железной дороги. Останавливается сама, не блокирует клики.
const COLORS = ["#F2B233", "#E5533D", "#3FA66B", "#3D8BE5", "#B65CE5", "#FFFFFF", "#F28C33"];

function reduced() {
  return typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let active = null;

export function stopConfetti() {
  if (active) { active(); active = null; }
}

export function runConfetti(host, { duration = 5200, power = 1 } = {}) {
  if (!host || reduced() || typeof document === "undefined") return () => {};
  stopConfetti();
  const canvas = document.createElement("canvas");
  canvas.className = "room-confetti";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const w = canvas.width = host.clientWidth || window.innerWidth;
  const h = canvas.height = host.clientHeight || window.innerHeight;
  const rnd = Math.random;
  const parts = [];
  const mk = (x, y, vx, vy) => parts.push({
    x, y, vx, vy,
    size: 5 + rnd() * 7, rot: rnd() * Math.PI, vr: (rnd() - 0.5) * 0.35,
    color: COLORS[Math.floor(rnd() * COLORS.length)],
    shape: ["rect", "circle", "ribbon"][Math.floor(rnd() * 3)],
    life: 0
  });
  // Залпы из нижних углов.
  for (let i = 0; i < 70 * power; i++) mk(0, h * 0.85, 6 + rnd() * 9, -(9 + rnd() * 9));
  for (let i = 0; i < 70 * power; i++) mk(w, h * 0.85, -(6 + rnd() * 9), -(9 + rnd() * 9));
  // Дождь сверху.
  for (let i = 0; i < 80 * power; i++) mk(rnd() * w, -20 - rnd() * h * 0.4, (rnd() - 0.5) * 2, 2 + rnd() * 3);

  const ctx = canvas.getContext("2d");
  const start = performance.now();
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); canvas.remove(); };
  const draw = (now) => {
    if (now - start > duration || !canvas.isConnected) { stop(); if (active === stop) active = null; return; }
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 0.22; p.vx *= 0.992; // гравитация и сопротивление
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, (duration - (now - start)) / 900));
      ctx.fillStyle = p.color;
      if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      else if (p.shape === "ribbon") ctx.fillRect(-p.size, -1.5, p.size * 2, 3);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  active = stop;
  return stop;
}
