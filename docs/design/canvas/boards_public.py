"""Public and auth artboards: landing, login, reset, MFA, unauthorized, apply, renew, privacy."""

from lib import (
    alert, badge, button, checkbox, decor, document, emblem, esc, field, footer_strip, icon, label,
    select, text_input, wordmark,
)

# Field lists mirror the designer's [FINAL] Membership Application frame; labels use the
# app's wording so the e2e selectors keep matching (they are uppercased by CSS).

SEX = ["Select…", "Male", "Female", "Prefer not to say"]
AWARD = ["Select…", "RA 7687", "Merit", "JLSS RA 7687", "JLSS Merit", "JLSS RA 10612"]
YEARS = ["Select…"] + [str(y) for y in range(2026, 2015, -1)]
LEVELS = ["Select…", "1st year", "2nd year", "3rd year", "4th year", "5th year"]
REGIONS = ["Select your region…", "National Capital Region", "CALABARZON", "Central Luzon", "Central Visayas", "Western Visayas", "Davao Region"]
UNIS = ["Select your university…", "University of the Philippines Diliman — Quezon City", "Ateneo de Manila University — Quezon City", "Mapúa University — Manila", "University of San Carlos — Cebu City"]
PROGRAMS = ["Select your program…", "BS Computer Science", "BS Information Technology", "BS Electronics Engineering", "BS Mathematics", "BS Physics"]


def hero(cta: str, width_note: str = "", compact: bool = False) -> str:
    return (
        '<div style="display:flex;flex-direction:column;align-items:center;gap:26px;padding:%s">'
        % ("56px 20px 40px" if compact else "72px 20px 56px")
        + emblem(120 if compact else 150)
        + wordmark(44 if compact else 64, "p")
        + f'<a class="pill" href="#application-form" style="{"height:48px;font-size:16px;padding:0 26px" if compact else ""}">{esc(cta)} <span aria-hidden="true">→</span></a>'
        + "</div>"
    )


STEPS = ["Personal", "Scholarship & school", "Documents", "Review & submit"]


def stepper(mobile: bool = False) -> str:
    """Four-step progress bar; the current step is bound to state (`{{sN}}` = 'on'/'done')."""
    items = []
    for i, name in enumerate(STEPS, start=1):
        items.append(
            f'<button class="step {{{{step{i}}}}}" type="button" onClick="{{{{goStep{i}}}}}">'
            f'<span class="dot">{i}</span><span class="name">{esc(name)}</span></button>'
            + ('<span class="line"></span>' if i < len(STEPS) else "")
        )
    return f'<div class="stepper{" mobile" if mobile else ""}">' + "".join(items) + "</div>"


def wizard_nav(step: int, last: bool = False, mobile: bool = False, submit_text: str = "Submit application") -> str:
    back = f'<button class="btn outline" type="button" onClick="{{{{goStep{step - 1}}}}}">Back</button>' if step > 1 else "<span></span>"
    nxt = (
        f'<button class="btn" type="submit" style="min-width:{"100%" if mobile else "240px"}">{esc(submit_text)}</button>'
        if last
        else f'<button class="btn" type="button" onClick="{{{{goStep{step + 1}}}}}" style="min-width:{"100%" if mobile else "200px"}">Next</button>'
    )
    return f'<div class="row" style="justify-content:space-between;padding-top:10px{";flex-direction:column-reverse;gap:12px" if mobile else ""}">{back}{nxt}</div>'


def form_card(kind: str, mobile: bool = False) -> str:
    """The application / renewal card as a four-step form. `kind` is 'apply' or 'renew'."""
    g2 = "grid2"
    g3 = "grid3"
    pad = "28px 20px" if mobile else "44px 56px"
    title = "Membership application form" if kind == "apply" else "Membership renewal form"
    identity = ""
    if kind == "renew":
        identity = (
            '<div class="stack" style="gap:18px">'
            '<p class="h2">Your membership</p>'
            '<p class="small muted">Your member ID, as issued when you joined. It never changes — a 2024 member renews as 2024-xxxx.</p>'
            f'<div class="{g2}">' + field("Member ID", text_input("e.g. 2024-0012")) + "</div>"
            '<p class="small muted">The email address you enter under <strong>Personal information</strong> must be the one START-DOST has on file for you. If it has changed, contact CRRD before renewing.</p>'
            "</div>"
        )
    upload = lambda title_, desc, testid: (  # noqa: E731
        f'<div class="stack" style="gap:10px" data-testid="{testid}">'
        f'<p class="h2">{esc(title_)}</p><p class="small muted">{esc(desc)}</p>'
        '<label class="row" style="gap:14px;height:64px;border:1.5px dashed #C9CCD1;border-radius:12px;padding:0 18px;background:var(--field);cursor:pointer">'
        + icon("upload", 20, "#6C6F72")
        + '<span style="font-weight:500;color:var(--ink)">Choose a file</span><span class="small muted">PDF, JPEG, PNG or HEIC · up to 10MB</span>'
        "</label></div>"
    )
    consent = (
        '<div class="stack" style="gap:14px">'
        '<p class="h2">Privacy and consent</p>'
        '<label class="row" style="align-items:flex-start;gap:12px;font-size:13.5px;line-height:1.55">'
        + checkbox(False)
        + '<span>I have read the <a href="#">privacy notice</a> and agree to START-DOST CRRD collecting and processing my personal and academic information to review this application. I understand this information is kept for up to five years after my last active term with the organization. I also understand that my uploaded proof of enrollment is stored securely, is viewed only by authorized reviewers, and that every view of it is recorded.</span></label>'
        '<label class="row" style="align-items:flex-start;gap:12px;font-size:13.5px;line-height:1.55">'
        + checkbox(False)
        + "<span>I certify that all the information I provided is accurate, and I understand that falsification of any information or document may lead to my being banned from future START activities.</span></label>"
        "</div>"
    )
    submit_text = "Submit application" if kind == "apply" else "Submit renewal"
    step1 = (
        '<sc-if value="{{is1}}" hint-placeholder-val="{{true}}"><div class="stack" style="gap:22px">'
        + identity
        + '<div class="stack" style="gap:4px"><p class="h2">Personal information</p><p class="small muted">As it appears on your Notice of Award and school records.</p></div>'
        f'<div class="{g2}">'
        + field("First name", text_input())
        + field("Middle name (optional)", text_input())
        + field("Last name", text_input())
        + field("Suffix (optional)", text_input("Jr., III, …"))
        + "</div>"
        f'<div class="{g3}">'
        + field("Sex", select(SEX))
        + field("Date of birth", text_input("YYYY-MM-DD", kind="date"))
        + field("Age", text_input("", value="—", extra_class="", style="color:var(--label)"))
        + "</div>"
        f'<div class="{g3}">'
        + field("Email address", text_input("", kind="email"))
        + field("Contact number", text_input("09171234567", kind="tel"))
        + field("Facebook account link", text_input("https://facebook.com/yourname", kind="url"))
        + "</div>"
        + wizard_nav(1, mobile=mobile)
        + "</div></sc-if>"
    )
    step2 = (
        '<sc-if value="{{is2}}" hint-placeholder-val="{{false}}"><div class="stack" style="gap:22px">'
        '<div class="stack" style="gap:4px"><p class="h2">Scholarship and school</p><p class="small muted">From your Notice of Award and your current enrollment.</p></div>'
        f'<div class="{g2}">'
        + field("DOST scholarship award", select(AWARD))
        + field("Year of award", select(YEARS))
        + field("University", select(UNIS))
        + field("Program", select(PROGRAMS))
        + field("Year level", select(LEVELS))
        + field("Expected year of graduation", text_input("2028"))
        + "</div>"
        '<p class="small muted">Not listed? Choose the nearest campus and tell CRRD in your email. CRRD keeps the list and adds schools as scholars apply.</p>'
        '<div class="stack" style="gap:4px"><p class="h2">Region</p><p class="small muted">Which region are you applying under?</p></div>'
        f'<div class="{g2}">' + field("Region", select(REGIONS)) + "</div>"
        + wizard_nav(2, mobile=mobile)
        + "</div></sc-if>"
    )
    step3 = (
        '<sc-if value="{{is3}}" hint-placeholder-val="{{false}}"><div class="stack" style="gap:22px">'
        '<div class="stack" style="gap:4px"><p class="h2">Documents</p><p class="small muted">Two files. A clear phone photo or a PDF, up to 10MB each. They go straight to secure storage.</p></div>'
        f'<div class="{g2}">'
        + upload("Latest registration form", "Your Certificate of Registration for the current term, or the enrollment form your school issues each term.", "upload-registration")
        + upload("Notice of Award", "The DOST-SEI Notice of Award for your scholarship. This is what proves you are a DOST scholar.", "upload-noa")
        + "</div>"
        + wizard_nav(3, mobile=mobile)
        + "</div></sc-if>"
    )
    summary = (
        '<div class="panel" style="display:grid;grid-template-columns:repeat(%d,minmax(0,1fr));gap:12px 24px;background:var(--field);box-shadow:none">' % (1 if mobile else 3)
        + "".join(f'<div class="stack" style="gap:2px">{label(k)}<span style="color:var(--ink)">{esc(v)}</span></div>' for k, v in [("Name", "Bea Bautista"), ("Email", "bea@example.com"), ("Contact number", "09171234567"), ("Scholarship", "RA 7687, 2024"), ("School", "UP Diliman, BS Computer Science"), ("Region", "National Capital Region")])
        + "</div>"
    )
    step4 = (
        '<sc-if value="{{is4}}" hint-placeholder-val="{{false}}"><div class="stack" style="gap:22px">'
        '<div class="stack" style="gap:4px"><p class="h2">Review and submit</p><p class="small muted">Check your answers. Use Back to change anything.</p></div>'
        + summary
        + consent
        + wizard_nav(4, last=True, mobile=mobile, submit_text=submit_text)
        + "</div></sc-if>"
    )
    return (
        f'<div class="card" id="application-form" style="padding:{pad};display:flex;flex-direction:column;gap:28px;width:100%">'
        f'<div class="stack" style="gap:18px;align-items:center"><h1 style="font-size:{"22px" if mobile else "32px"};font-weight:700;letter-spacing:.01em;text-transform:uppercase;color:var(--slate);text-align:center">{esc(title)}</h1>'
        '<div class="rule" style="width:100%"></div></div>'
        + stepper(mobile)
        + step1 + step2 + step3 + step4
        + "</div>"
    )


def closed_card(kind: str) -> str:
    if kind == "apply":
        h = "Applications are not open right now"
        p = "START-DOST is not currently accepting membership applications. Watch START-DOST's official channels for the next application period."
        q = "Already submitted an application? "
    else:
        h = "Membership renewal is not open right now"
        p = "START-DOST opens renewals at the start of each term. Watch START-DOST's official channels — and your inbox — for the renewal announcement."
        q = "Questions about your membership? "
    return (
        '<div class="card" style="padding:44px 48px;max-width:560px;text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center">'
        + '<span style="display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--warning-soft);color:var(--warning)">'
        + icon("clock", 24)
        + "</span>"
        f'<h1 style="font-size:22px;font-weight:600;color:var(--ink)">{esc(h)}</h1>'
        f'<p>{esc(p)}</p>'
        f'<p>{esc(q)}<a href="#">Contact CRRD</a> with any questions.</p>'
        '<a href="#" style="font-weight:500">Return home</a>'
        "</div>"
    )


def success_card(kind: str) -> str:
    if kind == "apply":
        h = "Application received"
        p1 = "Your membership application has been submitted and is now <strong>pending review</strong>. You do not need to do anything else right now."
        p2 = "A decision follows after the application period closes. If you are approved, you will receive an email at the address you provided."
        p3 = 'Made a mistake, or need to change something? <a href="#">Contact CRRD</a> — they can update your application directly.'
    else:
        h = "Renewal received"
        p1 = "Your renewal is <strong>pending review</strong> by the Community and Regional Relations Department. Your member ID stays the same; once approved, your membership for the new term is active and you will hear from CRRD by email."
        p2 = "Made a mistake? Contact CRRD and they will correct it on your record — you do not need to submit again."
        p3 = ""
    return (
        '<div class="card" style="padding:44px 48px;max-width:560px;text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center">'
        '<span style="display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--success-soft);color:var(--success)">'
        + icon("check", 26)
        + "</span>"
        f'<h1 style="font-size:22px;font-weight:600;color:var(--ink)">{esc(h)}</h1>'
        f"<p>{p1}</p><p>{p2}</p>" + (f"<p>{p3}</p>" if p3 else "") + "</div>"
    )


def public_page(kind: str, mobile: bool = False) -> str:
    """Apply/Renew with an `state` tweak: open / closed / success."""
    w = 390 if mobile else 1440
    cta = "Become part of the START Community" if kind == "apply" else "Renew your START membership"
    inner_w = "100%" if mobile else "1040px"
    body = (
        f'<div class="brand-bg{" mobile" if mobile else ""}" style="width:{w}px;min-height:{844 if mobile else 900}px;display:flex;flex-direction:column">'
        + decor(mobile=mobile)
        + hero(cta, compact=mobile)
        + f'<div style="flex:1;display:flex;justify-content:center;padding:0 {"16px" if mobile else "40px"} 72px">'
        f'<div style="width:{inner_w};max-width:100%;display:flex;justify-content:center">'
        '<sc-if value="{{isOpen}}" hint-placeholder-val="{{true}}">' + form_card(kind, mobile) + "</sc-if>"
        '<sc-if value="{{isClosed}}" hint-placeholder-val="{{false}}">' + closed_card(kind) + "</sc-if>"
        '<sc-if value="{{isSuccess}}" hint-placeholder-val="{{false}}">' + success_card(kind) + "</sc-if>"
        "</div></div>"
        + footer_strip()
        + "</div>"
    )
    logic = (
        "const state = this.props.state ?? 'open';\n"
        "      const step = this.state.step ?? 1;\n"
        "      const vals = { isOpen: state === 'open', isClosed: state === 'closed', isSuccess: state === 'success' };\n"
        "      for (let i = 1; i <= 4; i++) {\n"
        "        vals['is' + i] = step === i;\n"
        "        vals['step' + i] = step === i ? 'on' : (step > i ? 'done' : '');\n"
        "        vals['goStep' + i] = () => this.setState({ step: i });\n"
        "      }\n"
        "      return vals;"
    )
    props = {"state": {"editor": "enum", "options": ["open", "closed", "success"], "default": "open", "section": "State"}}
    extra = STEPPER_CSS + (".mobile .footer{flex-direction:column;align-items:flex-start;gap:14px;padding:20px}" if mobile else "")
    h = (1500 if kind == "apply" else 1580) if mobile else (1120 if kind == "apply" else 1200)
    return document(body, logic=logic, props=props, preview=(w, h), extra_css=extra)


STEPPER_CSS = """
.stepper{display:flex;align-items:center;gap:6px;width:100%}
.step{display:flex;align-items:center;gap:10px;background:none;border:0;padding:0;color:var(--label);font-weight:500;font-size:13px;white-space:nowrap}
.step .dot{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--field);color:var(--label);font-weight:600;box-shadow:0 2px 6px rgba(23,23,23,.08)}
.step.on .dot{background:linear-gradient(90deg,var(--blue-soft),var(--yellow-soft));color:var(--ink)}
.step.on .name{color:var(--ink);font-weight:600}
.step.done .dot{background:var(--blue);color:#fff}
.step.done .name{color:var(--body)}
.stepper .line{flex:1;height:2px;background:var(--line);border-radius:2px;margin:0 6px}
.stepper.mobile .name{display:none}
"""


# ── Landing ──────────────────────────────────────────────────────────────────

def landing(mobile: bool = False) -> str:
    w, h = (390, 844) if mobile else (1440, 900)
    body = (
        f'<div class="brand-bg" style="width:{w}px;height:{h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:{26 if mobile else 34}px;padding:24px">'
        + decor(mobile=mobile)
        + emblem(140 if mobile else 200)
        + f'<h1 class="wordmark" style="font-size:{48 if mobile else 84}px">START-SYS</h1>'
        + f'<a class="pill" href="/apply" style="{"height:52px;font-size:17px;padding:0 30px" if mobile else "min-width:440px"}">Ready for the START?</a>'
        + '<a href="/login" style="color:var(--body);font-size:14px;text-decoration:none;margin-top:10px">Officer sign in <span aria-hidden="true">→</span></a>'
        + "</div>"
    )
    return document(body, preview=(w, h))


# ── Login and the other auth cards ───────────────────────────────────────────

def auth_frame(inner: str, mobile: bool = False, height: int | None = None) -> str:
    w = 390 if mobile else 1440
    h = height or (844 if mobile else 900)
    return (
        f'<div class="brand-bg" style="width:{w}px;min-height:{h}px;display:flex;align-items:center;justify-content:center;padding:{"24px 16px" if mobile else "40px"}">'
        + decor(mobile=mobile)
        + inner
        + "</div>"
    )


def login(mobile: bool = False) -> str:
    card_w = "100%" if mobile else "820px"
    pad = "36px 28px" if mobile else "52px 72px 56px"
    inner = (
        f'<div class="card" style="width:{card_w};padding:{pad};display:flex;flex-direction:column;gap:26px">'
        '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:6px">'
        + emblem(64 if mobile else 84)
        + f'<h1 class="wordmark" style="font-size:{30 if mobile else 38}px">START-SYS</h1>'
        + '<p class="small muted" style="text-align:center">Centralized Membership Information Management System for START-DOST.</p>'
        "</div>"
        + field("Email address", text_input("", kind="email"))
        + field("Password", text_input("", kind="password"))
        + f'<div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:6px"><button class="btn" type="submit" style="width:{"100%" if mobile else "320px"};height:48px">Log in</button>'
        '<p class="small muted">Officer accounts are created by invitation.</p></div>'
        "</div>"
    )
    return document(auth_frame(inner, mobile), preview=((390, 844) if mobile else (1440, 900)))


def auth_card(title: str, intro: str, fields_html: str, action: str, width: str = "560px", extra_html: str = "") -> str:
    return (
        f'<div class="card" style="width:{width};padding:48px 56px;display:flex;flex-direction:column;gap:24px">'
        f'<div class="stack" style="gap:8px"><h1 style="font-size:22px;font-weight:600;color:var(--ink)">{esc(title)}</h1><p class="muted">{intro}</p></div>'
        + fields_html
        + f'<div>{action}</div>'
        + extra_html
        + "</div>"
    )


def password_reset() -> str:
    inner = auth_card(
        "Set a new password",
        "Use at least 12 characters.",
        field("New password", text_input("", kind="password")) + field("Confirm new password", text_input("", kind="password")),
        button("Change password", extra="min-width:220px"),
    )
    return document(auth_frame(inner), preview=(1440, 900))


def fake_qr(size: int = 208) -> str:
    """A QR-looking pattern (finder squares + deterministic modules), not a real code."""
    n = 25
    cell = size / n
    seed = 7
    rects = []
    def finder(x0, y0):
        for dx in range(7):
            for dy in range(7):
                edge = dx in (0, 6) or dy in (0, 6)
                core = 2 <= dx <= 4 and 2 <= dy <= 4
                if edge or core:
                    rects.append((x0 + dx, y0 + dy))
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7)
    for x in range(n):
        for y in range(n):
            in_finder = (x < 8 and y < 8) or (x >= n - 8 and y < 8) or (x < 8 and y >= n - 8)
            if in_finder:
                continue
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            if seed % 100 < 45:
                rects.append((x, y))
    body = "".join(f'<rect x="{x * cell:.1f}" y="{y * cell:.1f}" width="{cell + 0.3:.1f}" height="{cell + 0.3:.1f}"/>' for x, y in rects)
    return f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" fill="#171717" role="img" aria-label="Two-factor QR code">{body}</svg>'


def num_step(n: int, title: str, body: str) -> str:
    return (
        '<div class="row" style="align-items:flex-start;gap:14px">'
        f'<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:linear-gradient(90deg,var(--blue-soft),var(--yellow-soft));color:var(--ink);font-weight:700;flex:none">{n}</span>'
        f'<div class="stack" style="gap:6px"><p style="font-weight:600;color:var(--ink)">{esc(title)}</p>{body}</div></div>'
    )


def mfa_enroll() -> str:
    scan = (
        '<sc-if value="{{isScan}}" hint-placeholder-val="{{true}}">'
        '<div style="display:grid;grid-template-columns:260px 1fr;gap:40px;align-items:start">'
        '<div class="stack" style="gap:12px;align-items:center">'
        '<div style="padding:16px;background:#fff;border-radius:16px;border:1px solid var(--line);box-shadow:0 6px 20px rgba(23,23,23,.08)">' + fake_qr(208) + "</div>"
        '<p class="small muted" style="text-align:center">Scan with your authenticator app</p></div>'
        '<div class="stack" style="gap:22px">'
        + num_step(1, "Install an authenticator app", '<p class="muted">Google Authenticator, Authy or 1Password all work. Any app that shows 6-digit codes is fine.</p>')
        + num_step(2, "Scan the code, or type the key", '<div class="row" style="gap:10px"><p class="mono" style="background:var(--field);border-radius:10px;padding:10px 12px;flex:1;letter-spacing:.06em">JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP</p>' + button("Copy", "outline sm") + "</div>")
        + num_step(3, "Enter the code the app shows", field("Enter the 6-digit code from your app", text_input("000 000", extra_class="mono", style="width:220px;height:52px;font-size:24px;letter-spacing:.3em;text-align:center")))
        + '<div class="row" style="gap:16px;padding-top:4px">' + button("Verify and continue", extra="min-width:240px") + '<a href="#" class="small" style="color:var(--label)">Sign out</a></div>'
        "</div></div></sc-if>"
    )
    codes = ["4Q7K-2M9X", "H3PD-8ZLV", "N6WJ-1RCT", "B9YF-5KQE", "S2GA-7VMH", "X8LR-3PNZ", "T5CV-9WDA", "K1MQ-6JHB", "D4ZN-2XRS", "P7EW-8LGT"]
    codes_stage = (
        '<sc-if value="{{isCodes}}" hint-placeholder-val="{{false}}"><div class="stack" style="gap:22px">'
        '<div class="panel" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 32px;background:var(--field);box-shadow:none">'
        + "".join(f'<span class="mono" style="font-size:16px;color:var(--ink);letter-spacing:.06em">{c}</span>' for c in codes)
        + "</div>"
        '<div class="row" style="gap:10px">' + button("Copy codes", "outline sm") + button("Download", "outline sm") + "</div>"
        + alert("Each code works once. If you lose your phone, one of these codes is the only way back in.", "warning", "alert")
        + '<label class="row" style="align-items:flex-start;gap:12px">' + checkbox(False) + "<span>I have saved these codes somewhere I can reach without this device. I understand they will not be shown again.</span></label>"
        + '<div class="row" style="gap:16px">' + button("Continue", extra="min-width:200px", attrs="disabled") + '<a href="#" class="small" style="color:var(--label)">Sign out</a></div>'
        "</div></sc-if>"
    )
    inner = (
        '<div class="card" style="width:900px;padding:48px 56px;display:flex;flex-direction:column;gap:28px">'
        '<div class="row" style="gap:16px;align-items:center">' + emblem(44)
        + '<div class="stack" style="gap:4px"><sc-if value="{{isScan}}" hint-placeholder-val="{{true}}"><h1 style="font-size:24px;font-weight:600;color:var(--ink)">Set up two-factor authentication</h1><p class="muted">Officer accounts need a second step at sign-in. This takes about a minute.</p></sc-if>'
        '<sc-if value="{{isCodes}}" hint-placeholder-val="{{false}}"><h1 style="font-size:24px;font-weight:600;color:var(--ink)">Save your recovery codes</h1><p class="muted">These ten codes are shown once. Keep them somewhere safe and offline.</p></sc-if></div></div>'
        + scan + codes_stage
        + "</div>"
    )
    logic = (
        "const stage = this.props.stage ?? 'scan';\n"
        "      const vals = { isScan: stage === 'scan', isCodes: stage === 'codes' };\n"
        "      return vals;"
    )
    props = {"stage": {"editor": "enum", "options": ["scan", "codes"], "default": "scan", "section": "State"}}
    return document(auth_frame(inner), logic=logic, props=props, preview=(1440, 900))


def mfa_verify() -> str:
    inner = auth_card(
        "Enter your authentication code",
        "Your session needs a second factor before it can continue.",
        field("6-digit code", text_input("", extra_class="mono", style="width:200px;letter-spacing:.2em")),
        button("Verify", extra="min-width:200px"),
        extra_html='<a href="#" class="small" style="color:var(--label);align-self:flex-start">Sign out</a>',
    )
    return document(auth_frame(inner), preview=(1440, 900))


def unauthorized() -> str:
    inner = (
        '<div class="card" style="width:600px;padding:52px 56px;text-align:center;display:flex;flex-direction:column;gap:16px;align-items:center">'
        + '<span style="display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--field);color:var(--label)">'
        + icon("lock", 24)
        + "</span>"
        '<h1 style="font-size:22px;font-weight:600;color:var(--ink)">No role is assigned to this account</h1>'
        "<p>Your account is signed in, but no START-SYS role has been assigned to it yet. Contact a Technical Admin to have a role assigned — access takes effect on your next request, with no need to sign in again.</p>"
        + button("Back to login", "outline", href="/login")
        + "</div>"
    )
    return document(auth_frame(inner), preview=(1440, 900))


def privacy() -> str:
    sec = lambda h, p: f'<section class="stack" style="gap:8px"><h2 class="h2">{esc(h)}</h2><p>{p}</p></section>'  # noqa: E731
    inner = (
        '<div class="card" style="width:860px;padding:56px 64px;display:flex;flex-direction:column;gap:26px">'
        '<div class="stack" style="gap:6px"><h1 style="font-size:28px;font-weight:700;color:var(--ink)">START-DOST Privacy Notice</h1>'
        '<p class="muted">How START-DOST handles the information you give us when you apply.</p></div>'
        + sec("What we collect", "When you apply, we collect your name, birth date, sex, email, phone number and Facebook link. We also collect your scholarship details, your school and program, your region, and two documents: your registration form and your Notice of Award.")
        + sec("Why we collect it", "To check that you are a DOST scholar, and to run your membership. That means your member record, your committee, and the emails START-DOST sends you.")
        + sec("Who can see it", "Only the officers whose job needs it. The CRRD officers and the CEO and COO can see your contact details. Other officers and your Regional Representative see your name, member ID, region and status. The database itself enforces this, not just the screen.")
        + sec("Where it is stored", "Our database and app run on servers in Singapore. Your documents are stored in START-DOST's Google Drive. Emails are sent from START-DOST's Gmail account. Your information is stored outside the Philippines.")
        + sec("How long we keep it", "Five years after your last active term with START-DOST. An application you start but do not finish is cleared after 30 days.")
        + sec("Your rights", 'You can ask what we hold about you, ask us to correct it, object to how we use it, or file a complaint. These are your rights under the Data Privacy Act. Write to <a href="#">[ORG EMAIL]</a>.')
        + sec("If something goes wrong", "If your information is ever exposed, START-DOST will tell you and the National Privacy Commission within 72 hours.")
        + '<a href="/apply" style="font-weight:500">Back to the application</a>'
        "</div>"
    )
    return document(auth_frame(inner, height=1100), preview=(1440, 1100))


BOARDS = {
    "Main": (landing(False), 1440, 900),
    "LandingMobile": (landing(True), 390, 844),
    "Login": (login(False), 1440, 900),
    "LoginMobile": (login(True), 390, 844),
    "PasswordReset": (password_reset(), 1440, 900),
    "MfaEnroll": (mfa_enroll(), 1440, 900),
    "MfaVerify": (mfa_verify(), 1440, 900),
    "Unauthorized": (unauthorized(), 1440, 900),
    "Apply": (public_page("apply"), 1440, 1120),
    "ApplyMobile": (public_page("apply", mobile=True), 390, 1500),
    "Renew": (public_page("renew"), 1440, 1200),
    "RenewMobile": (public_page("renew", mobile=True), 390, 1580),
    "Privacy": (privacy(), 1440, 1100),
}
