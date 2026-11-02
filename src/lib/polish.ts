// Visual-only enhancements: scroll-reveal, scroll progress and a nav shadow on scroll.
// No app logic or data lives here; if anything fails, the page simply renders without motion.

const REVEAL_SELECTOR = [
  '.hero-copy', '.hero-art', '.expertise-heading', '.expertise-card', '.manifesto', '.landing-footer',
  '.login-card', '.metric-card', '.today-board', '.task-card', '.calendar-panel', '.performance-page > *',
  '.profile-page > *', '.info-page', '.template-library', '.dashboard-notepad-area',
].join(',');

export function installPolish() {
  if (typeof window === 'undefined') return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // Scroll progress + "scrolled" state for the sticky header.
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = root.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      root.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  if (reduceMotion || !('IntersectionObserver' in window)) return;
  root.classList.add('polish-motion');

  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

  const scan = () => {
    document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach(el => {
      if (el.dataset.reveal) return;
      el.dataset.reveal = '1';
      // Gentle stagger between siblings of the same kind.
      const siblings = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.className === el.className) : [];
      const index = Math.max(0, siblings.indexOf(el));
      el.style.setProperty('--reveal-delay', `${Math.min(index, 6) * 70}ms`);
      el.classList.add('reveal');
      io.observe(el);
    });
  };
  // React swaps screens (landing → login → workspace), so rescan when the DOM changes.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(); onScroll(); });
  }).observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
  scan();
}
