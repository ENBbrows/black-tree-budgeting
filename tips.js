/* ═════════════════════════════════════════════════════════
   BLACK TREE — field help bubbles.

   Any <label data-tip="..."> shows a small "?" and a dismissable
   bubble on hover or click/focus of the field right after it. Each
   bubble also carries a "Don't show these tips again" link that
   turns tips off permanently on this device (localStorage, so it's
   a per-device choice, same as everything else client-side here).
   ═════════════════════════════════════════════════════════ */
(function () {
  const KEY = "bt_hide_tips";

  function tipsHidden() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }

  function setTipsHidden(hidden) {
    try { hidden ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch (e) {}
  }

  function closeBubble() {
    const el = document.querySelector(".bt-tip-bubble");
    if (el) el.remove();
  }

  function showBubble(labelEl, anchorEl) {
    if (tipsHidden()) return;
    const text = labelEl.getAttribute("data-tip");
    if (!text) return;
    closeBubble();

    const bubble = document.createElement("div");
    bubble.className = "bt-tip-bubble";
    bubble.innerHTML = `
      <button class="bt-tip-close" aria-label="Close tip" type="button">&times;</button>
      <p></p>
      <button class="bt-tip-hide-all" type="button">Don't show these tips again</button>
    `;
    bubble.querySelector("p").textContent = text;
    document.body.appendChild(bubble);

    const r = (anchorEl || labelEl).getBoundingClientRect();
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    let top = r.bottom + 8;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 8);
    let left = Math.min(r.left, window.innerWidth - bw - 12);
    left = Math.max(12, left);
    bubble.style.top = top + "px";
    bubble.style.left = left + "px";

    bubble.querySelector(".bt-tip-close").addEventListener("click", closeBubble);
    bubble.querySelector(".bt-tip-hide-all").addEventListener("click", () => {
      setTipsHidden(true);
      closeBubble();
    });
  }

  function init() {
    // Deliberately not wired to a field's own "focus" — a bubble that pops
    // up just from typing into a field (rather than being asked for) can
    // reposition above a cramped field near the bottom of a form and end
    // up covering whatever's below it (a file picker, a submit button),
    // swallowing the next tap entirely. Hover and an explicit tap on the
    // label/"?" are asks; focus-to-type isn't.
    document.querySelectorAll("label[data-tip]").forEach((label) => {
      label.addEventListener("click", (e) => { e.preventDefault(); showBubble(label, label); });
      label.addEventListener("mouseenter", () => showBubble(label, label));
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".bt-tip-bubble") && !e.target.closest("label[data-tip]")) closeBubble();
    });
    // Moving focus anywhere — tabbing on, typing into the next field —
    // closes a bubble left open from a label tap/hover, so it never lingers
    // over whatever the user interacts with next.
    document.addEventListener("focusin", (e) => {
      if (!e.target.closest(".bt-tip-bubble")) closeBubble();
    }, true);
    window.addEventListener("scroll", closeBubble, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.btTipsHidden = tipsHidden;
  window.btSetTipsHidden = setTipsHidden;
})();
