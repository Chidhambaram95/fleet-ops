# Fleet Ops Vahan helper (Chrome extension)

Fills in Vahan's quarterly road tax (MV tax) for the bus you pick in Fleet Ops,
then stops at Vahan's "Confirm Tax Details" popup. It checks the vehicle number,
the owner name and the tax period against the bus record, highlights them on
the Vahan page and shows a green or red panel.

It never ticks "I hereby confirm…" and never clicks **Confirm Payment**. You
check and pay yourself.

It only runs on `https://vahan.parivahan.gov.in/vahanservice/*` and only keeps
the current job in Chrome's extension storage until the popup opens (or 30
minutes pass). It sends nothing anywhere.

## Install (once per computer)

1. Copy this `vahan-helper` folder to the computer.
2. In Chrome open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `vahan-helper` folder.
5. Pin "Fleet Ops Vahan helper" if you like. Nothing else to set up.

## Use

1. In Fleet Ops: **Documents due → Pay road tax on Vahan**.
2. Pick the bus and the quarter, then **Start on Vahan**.
3. Leave the Vahan tab alone while the panel says "Working…".
4. At the popup, read the panel:
   - **All match**: tick the confirm box, click Confirm Payment, pay.
   - **Stop – do not pay**: click Cancel and fix the bus details or the quarter.
5. After paying, go back to Fleet Ops and record the payment.

## When Vahan changes its pages

The steps and the page parts it reads are in `content.js` (see the comment at
the top). The matching rules are in `check.js`, tested by
`tests/unit/vahanHelperCheck.test.ts`.
