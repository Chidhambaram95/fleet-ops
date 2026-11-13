// Fleet Ops Vahan helper: fills in Vahan's "Pay Your Tax" for the bus picked in
// Fleet Ops and stops at the "Confirm Tax Details" popup. It never ticks the
// confirm box and never clicks "Confirm Payment": you check and pay yourself.
//
// Flow (Vahan Citizen Services, Tamil Nadu, Nov 2026):
//   homepage.xhtml        reg no → privacy tick → Proceed → "Authentication Modes" Proceed
//   usermgmt/login.xhtml  Tax/Fee Services → "Pay Your Tax"
//   form_eApplicatonHome  chassis last 5 → VERIFY DETAILS → Submit → Tax Mode QUARTERLY
//                         → Payment → confirm popup: check + highlight, then stop
(function () {
  "use strict";

  var V = globalThis.FleetOpsVahan;
  var STORE_KEY = "fleetopsVahanJob";
  var stopped = false;

  // ---------------------------------------------------------------------------
  // Job storage. The job arrives in the link's "#" part and is kept in the
  // extension's own storage while Vahan moves between pages.
  // ---------------------------------------------------------------------------

  function loadState() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORE_KEY, function (items) {
        resolve((items && items[STORE_KEY]) || null);
      });
    });
  }

  function saveState(state) {
    return new Promise(function (resolve) {
      var items = {};
      items[STORE_KEY] = state;
      chrome.storage.local.set(items, resolve);
    });
  }

  function clearState() {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(STORE_KEY, resolve);
    });
  }

  // Read the job before Vahan can redirect and lose the "#" part.
  var jobFromLink = V.readJob(location.hash);
  var linkSaved = Promise.resolve();
  if (jobFromLink) {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      // The link stays in the address bar; nothing else depends on it.
    }
    linkSaved = V.isFresh(jobFromLink, Date.now())
      ? saveState({ job: jobFromLink, seenReg: "", seenOwner: "" })
      : clearState();
  }

  // ---------------------------------------------------------------------------
  // Page helpers
  // ---------------------------------------------------------------------------

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function visible(element) {
    return Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function text(element) {
    return element ? String(element.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  /** Calls check every 300 ms until it returns something truthy; null after the timeout or on Stop. */
  async function waitFor(check, timeoutMs) {
    var end = Date.now() + (timeoutMs || 20000);
    while (Date.now() < end) {
      if (stopped) return null;
      var value = null;
      try {
        value = check();
      } catch {
        value = null;
      }
      if (value) return value;
      await sleep(300);
    }
    return null;
  }

  function enabled(button) {
    return Boolean(button && !button.disabled && !/ui-state-disabled/.test(button.className) && visible(button));
  }

  function setInput(input, value) {
    input.focus();
    input.value = value;
    ["input", "keyup", "change"].forEach(function (type) {
      input.dispatchEvent(new Event(type, { bubbles: true }));
    });
    input.blur();
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function visibleButton(scope, label) {
    var buttons = (scope || document).querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      if (text(buttons[i]) === label && visible(buttons[i])) return buttons[i];
    }
    return null;
  }

  /** Vahan's own error or info messages that are showing, joined. */
  function vahanMessages() {
    var found = [];
    var nodes = document.querySelectorAll(
      ".ui-growl-message, .ui-messages-error, .ui-messages-warn, .ui-message-error, .ui-dialog .ui-dialog-content",
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (!visible(node)) continue;
      if (node.closest && node.closest("#taxFrom\\:confirmationPopup")) continue;
      var message = text(node);
      if (message && message.length < 300) found.push(message);
    }
    return found.join(" · ");
  }

  // ---------------------------------------------------------------------------
  // The helper panel (bottom right). Its own shadow DOM keeps Vahan's styles out.
  // ---------------------------------------------------------------------------

  var panelBody = null;

  function ensurePanel() {
    if (panelBody) return panelBody;
    var host = document.createElement("div");
    host.id = "fleetops-vahan-helper";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" +
      ".card{width:min(420px,calc(100vw - 32px));max-height:70vh;overflow:auto;box-sizing:border-box;background:#fff;color:#14142b;border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.35);padding:16px 18px;font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}" +
      ".title{font-weight:800;font-size:16px}" +
      ".pill{font-size:12px;font-weight:700;border-radius:10px;padding:3px 9px;white-space:nowrap}" +
      ".ok{background:#dff5e6;color:#17663a}.bad{background:#a8321c;color:#fff}.warn{background:#fff3d6;color:#8a5a00}.busy{background:#e6e6fa;color:#3b3fb6}" +
      "table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:8px 4px;border-bottom:1px solid #eee;vertical-align:top;font-size:13px}" +
      "td.l{color:#555;width:70px}td.s{white-space:nowrap;font-weight:700;text-align:right}" +
      ".s-ok{color:#17663a}.s-bad{color:#a8321c}.s-warn{color:#8a5a00}.s-info{color:#555}" +
      ".msg{margin:8px 0 0}.err{color:#a8321c}.muted{color:#666;font-size:12px}" +
      "button{border:0;border-radius:12px;padding:8px 12px;font-weight:700;cursor:pointer;background:#f1f1fb;color:#3b3fb6}" +
      "</style>" +
      "<div class='card'><div class='head'><span class='title'>Fleet Ops helper</span><span id='badge'></span></div>" +
      "<div id='body'></div>" +
      "<div style='display:flex;justify-content:flex-end;margin-top:10px'><button id='stop' type='button'>Stop helper</button></div></div>";
    shadow.getElementById("stop").addEventListener("click", function () {
      stopped = true;
      void clearState();
      host.remove();
      panelBody = null;
    });
    (document.body || document.documentElement).appendChild(host);
    panelBody = { shadow: shadow, host: host };
    return panelBody;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function showStatus(kind, html) {
    var panel = ensurePanel();
    var badges = { busy: ["busy", "Working…"], ok: ["ok", "All match"], warn: ["warn", "Check amount"], bad: ["bad", "Stop – do not pay"], error: ["bad", "Stopped"] };
    var badge = badges[kind] || badges.busy;
    panel.shadow.getElementById("badge").innerHTML = "<span class='pill " + badge[0] + "'>" + badge[1] + "</span>";
    panel.shadow.getElementById("body").innerHTML = html;
  }

  function busy(message) {
    showStatus("busy", "<p class='msg'>" + escapeHtml(message) + "</p><p class='muted'>Please don't click on Vahan while this runs.</p>");
  }

  async function fail(message) {
    stopped = true;
    await clearState();
    var extra = vahanMessages();
    showStatus(
      "error",
      "<p class='msg err'>" +
        escapeHtml(message) +
        "</p>" +
        (extra ? "<p class='muted'>Vahan says: " + escapeHtml(extra) + "</p>" : "") +
        "<p class='muted'>Carry on by hand in Vahan, or press Start on Vahan in Fleet Ops again.</p>",
    );
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  async function doHome(state) {
    busy("Entering the vehicle number…");
    var close = await waitFor(function () {
      var button = document.querySelector("#updatemobileno .btn-close");
      return visible(button) ? button : null;
    }, 4000);
    if (close) {
      close.click();
      await sleep(500);
    }
    var reg = await waitFor(function () {
      var input = byId("regnid");
      return visible(input) ? input : null;
    }, 15000);
    if (!reg) return fail("Could not find Vahan's vehicle number box.");
    setInput(reg, V.normalizeRegistration(state.job.reg));
    await sleep(500);

    // The privacy tick box: a visible tick box in the same form whose nearby text mentions the Privacy Policy.
    var tick = null;
    var boxes = (reg.form || document).querySelectorAll(".ui-chkbox");
    for (var i = 0; i < boxes.length && !tick; i += 1) {
      if (!visible(boxes[i])) continue;
      var around = boxes[i];
      for (var level = 0; level < 5 && around; level += 1) {
        if (/Privacy Policy/i.test(around.textContent || "")) {
          tick = boxes[i];
          break;
        }
        around = around.parentElement;
      }
    }
    if (!tick) return fail("Could not find the privacy policy tick box.");
    var tickInput = tick.querySelector("input");
    if (tickInput && !tickInput.checked) {
      tick.querySelector(".ui-chkbox-box").click();
    }

    busy("Waiting for Vahan to accept the vehicle number…");
    var proceed = await waitFor(function () {
      var button = byId("proccedHomeButtonId");
      return enabled(button) ? button : null;
    }, 25000);
    if (!proceed) return fail("Vahan did not enable Proceed for this vehicle number.");
    proceed.click();

    var modeProceed = await waitFor(function () {
      var dialog = byId("facelesslist");
      return visible(dialog) ? visibleButton(dialog, "Proceed") : null;
    }, 20000);
    if (modeProceed) {
      modeProceed.click();
      busy("Opening Tax/Fee Services…");
    } else if (/homepage\.xhtml/.test(location.pathname)) {
      return fail("Vahan did not move on from the first page.");
    }
  }

  async function doServices() {
    busy("Opening Pay Your Tax…");
    var tile = await waitFor(function () {
      var nodes = document.querySelectorAll("div, span");
      for (var i = 0; i < nodes.length; i += 1) {
        if (nodes[i].childElementCount === 0 && text(nodes[i]) === "Pay Your Tax" && visible(nodes[i])) {
          return nodes[i].closest("a") || nodes[i];
        }
      }
      return null;
    }, 20000);
    if (!tile) return fail("Could not find Pay Your Tax.");
    tile.click();
  }

  function taxRow() {
    var body = byId("taxFrom:sub_view_tax_dtls:tableTax_data");
    return body ? body.querySelector("tr") : null;
  }

  function modeSelect(row) {
    return row ? row.querySelector("select[id$='_input']") : null;
  }

  function bannerReg() {
    var cells = document.querySelectorAll("div");
    for (var i = 0; i < cells.length; i += 1) {
      if (cells[i].childElementCount === 0 && /Vehicle Registration No\.?\s*:/i.test(cells[i].textContent || "")) {
        return { element: cells[i], value: text(cells[i]).replace(/^.*Vehicle Registration No\.?\s*:/i, "").trim() };
      }
    }
    return null;
  }

  async function doTaxPage(state) {
    // 1. Chassis number.
    var chassis = byId("form_eapp:tf_chasis_no");
    if (visible(chassis) && !chassis.disabled) {
      var regBox = byId("form_eapp:tf_reg_no");
      var shownReg = regBox ? regBox.value : "";
      if (V.normalizeRegistration(shownReg) !== V.normalizeRegistration(state.job.reg)) {
        return fail("Vahan opened " + (shownReg || "another vehicle") + ", not " + state.job.reg + ".");
      }
      state.seenReg = shownReg;
      await saveState(state);
      busy("Entering the chassis number…");
      setInput(chassis, state.job.chassisLast5);
      var verify = byId("form_eapp:validate_button");
      if (!enabled(verify)) return fail("Could not find VERIFY DETAILS.");
      verify.click();
    }

    // 2. Submit (shows once the chassis number is accepted).
    var next = await waitFor(function () {
      var submit = byId("form_eapp:tf_show_button");
      if (enabled(submit)) return { submit: submit };
      if (taxRow()) return { table: true };
      return null;
    }, 20000);
    if (!next) return fail("Vahan did not accept the chassis number.");
    if (next.submit) {
      busy("Loading the tax details…");
      next.submit.click();
    }

    // 3. Tax page: owner name, then Tax Mode QUARTERLY.
    var row = await waitFor(taxRow, 25000);
    if (!row) return fail("The tax details did not load.");
    var ownerBox = byId("taxFrom:tf_owner_name");
    state.seenOwner = ownerBox ? String(ownerBox.value || ownerBox.textContent || "").trim() : "";
    await saveState(state);

    var advance = byId("taxFrom:sub_view_tax_dtls:tf_NOAdv");
    if (advance && String(advance.value).trim() !== "1") {
      return fail("Vahan's \"No. of Month/Year/Quarter\" is " + advance.value + ", not 1. Fleet Ops pays one quarter at a time.");
    }

    var select = modeSelect(row);
    if (!select) return fail("Could not find Tax Mode.");
    var quarterly = null;
    for (var i = 0; i < select.options.length; i += 1) {
      if (/^QUARTERLY$/i.test(select.options[i].text.trim())) quarterly = select.options[i];
    }
    if (!quarterly) return fail("Vahan does not offer QUARTERLY tax for this vehicle.");
    if (select.value !== quarterly.value) {
      busy("Choosing QUARTERLY…");
      var menu = select.closest(".ui-selectonemenu");
      var trigger = menu && menu.querySelector(".ui-selectonemenu-trigger");
      if (!menu || !trigger) return fail("Could not open Tax Mode.");
      trigger.click();
      var item = await waitFor(function () {
        var panel = byId(menu.id + "_panel");
        if (!panel) return null;
        var items = panel.querySelectorAll("li");
        for (var j = 0; j < items.length; j += 1) {
          if (/^QUARTERLY$/i.test((items[j].getAttribute("data-label") || text(items[j])).trim())) return items[j];
        }
        return null;
      }, 5000);
      if (!item) return fail("Could not pick QUARTERLY.");
      item.click();
    }
    var filled = await waitFor(function () {
      var current = taxRow();
      return current && current.cells.length > 3 && /\d{2}-\d{2}-\d{4}/.test(text(current.cells[2])) ? current : null;
    }, 20000);
    if (!filled) return fail("Vahan did not work out the quarterly tax.");

    // 4. Payment → the confirm popup.
    busy("Opening the payment summary…");
    var popup = null;
    for (var attempt = 0; attempt < 3 && !popup; attempt += 1) {
      var payment = visibleButton(document, "Payment");
      if (!payment) return fail("Could not find the Payment button.");
      payment.click();
      popup = await waitFor(function () {
        var dialog = byId("taxFrom:confirmationPopup");
        return visible(dialog) ? dialog : null;
      }, 6000);
    }
    if (!popup) return fail("The payment summary did not open.");
    await showCheck(state, popup);
  }

  function highlight(element, good) {
    if (!element) return;
    element.style.outline = "3px solid " + (good ? "#f5b400" : "#a8321c");
    element.style.outlineOffset = "1px";
    element.style.background = good ? "#fff6cc" : "#fde2dc";
  }

  async function showCheck(state, popup) {
    var spans = popup.querySelectorAll("span.blue.inline-section");
    var banner = bannerReg();
    var ownerBox = byId("taxFrom:tf_owner_name");
    var seen = {
      reg: (banner && banner.value) || state.seenReg,
      owner: (ownerBox && String(ownerBox.value || "").trim()) || state.seenOwner,
      mode: spans[0] ? text(spans[0]) : "",
      total: spans[1] ? text(spans[1]) : "",
      from: spans[2] ? text(spans[2]) : "",
      to: spans[3] ? text(spans[3]) : "",
    };
    var check = V.checkVahan(state.job, seen);
    var status = {};
    check.rows.forEach(function (row) {
      status[row.id] = row.status;
    });

    // Yellow where it matches, red where it does not, on Vahan's own page.
    if (banner) highlight(banner.element, status.vehicle === "ok");
    highlight(ownerBox, status.owner === "ok");
    highlight(spans[2], status.period === "ok");
    highlight(spans[3], status.period === "ok");
    highlight(spans[1], status.amount !== "bad" && status.amount !== "warn");

    if (check.result === "stop") {
      var warning = document.createElement("div");
      warning.textContent = "Fleet Ops: these details do not match the bus. Do not pay. Click Cancel.";
      warning.style.cssText = "margin:8px 12px;padding:10px;border-radius:8px;background:#a8321c;color:#fff;font-weight:bold;text-align:center";
      var confirmRow = visibleButton(popup, "Confirm Payment");
      (confirmRow && confirmRow.parentElement ? confirmRow.parentElement : popup).prepend(warning);
    }

    var marks = { ok: "✓ match", bad: "✗ different", warn: "! check", info: "info" };
    var rows = check.rows
      .map(function (row) {
        var detail =
          row.status === "ok"
            ? escapeHtml(row.seen)
            : "Fleet Ops: " + escapeHtml(row.expected) + "<br>Vahan: <b>" + escapeHtml(row.seen) + "</b>";
        if (row.id === "amount" && row.status !== "bad") detail = escapeHtml(row.seen) + " <span class='muted'>(" + escapeHtml(row.expected) + ")</span>";
        return "<tr><td class='l'>" + row.label + "</td><td>" + detail + "</td><td class='s s-" + row.status + "'>" + marks[row.status] + "</td></tr>";
      })
      .join("");
    var footer =
      check.result === "stop"
        ? "<p class='msg err'><b>Do not pay.</b> Click Cancel on Vahan, then fix the bus details or the quarter in Fleet Ops.</p>"
        : check.result === "warn"
          ? "<p class='msg'>The amount is more than 10% different from last time. If it looks right, tick the confirm box and click <b>Confirm Payment</b>.</p>"
          : "<p class='msg'><b>Your turn:</b> tick the confirm box and click <b>Confirm Payment</b>. After paying, record it in Fleet Ops.</p>";
    showStatus(check.result === "stop" ? "bad" : check.result, "<table>" + rows + "</table>" + footer);

    // Done: a reload must not run the steps again.
    await clearState();
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  async function main() {
    await linkSaved;
    if (jobFromLink && !V.isFresh(jobFromLink, Date.now())) {
      showStatus("error", "<p class='msg err'>This link is more than 30 minutes old.</p><p class='muted'>Press Start on Vahan in Fleet Ops again.</p>");
      return;
    }
    var state = await loadState();
    if (!state || !state.job) return;
    if (!V.isFresh(state.job, Date.now())) {
      await clearState();
      return;
    }
    var path = location.pathname;
    try {
      if (/\/statevalidation\/homepage\.xhtml$/.test(path)) await doHome(state);
      else if (/\/usermgmt\/login\.xhtml$/.test(path)) await doServices(state);
      else if (/\/eapplication\/form_eApplicatonHome\.xhtml$/.test(path)) await doTaxPage(state);
      else busy("Waiting for Vahan…");
    } catch (error) {
      await fail("Something went wrong: " + (error && error.message ? error.message : String(error)));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      void main();
    });
  } else {
    void main();
  }
})();
