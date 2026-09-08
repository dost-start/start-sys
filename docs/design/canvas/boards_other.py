"""Officer and Regional Representative artboards — read-only surfaces in the shell."""

from lib import OFFICER_LINKS, RR_LINKS, alert, badge, bars, button, document, esc, label, nav_logic, select, shell, stat, table, text_input

from boards_admin import PEOPLE, h1, mono, sbadge, section


def officer_board(active, title, content, role, links, height=900):
    body = shell(links, active, title, role, content, min_height=height)
    logic = "const vals = {};\n      " + nav_logic(links, active) + "\n      return vals;"
    return document(body, logic=logic, preview=(1440, height))


def status_tiles(region_only: bool = False) -> str:
    counts = (
        [("Renewal pending", "1"), ("Active", "10"), ("Graduated", "1"), ("Resigned", "0"), ("Left", "0"), ("Terminated", "0")]
        if region_only
        else [("Renewal pending", "1"), ("Active", "20"), ("Graduated", "2"), ("Resigned", "1"), ("Left", "0"), ("Terminated", "0")]
    )
    return '<div class="grid3" style="gap:16px">' + "".join(stat(n, lab) for lab, n in counts) + "</div>"


def directory() -> str:
    rows = [[mono(mid), f"{f}, {g}", sbadge(st), region, yl, cm, dept] for (f, g, mid, st, region, joined, cm, dept), yl in zip(PEOPLE, ["3", "2", "2", "1", "3", "4", "1", "4", "2", "1"])]
    content = (
        h1("Directory", "Term 2026-2027 · read-only")
        + '<div class="stack" style="gap:28px">'
        + section("Members by status", status_tiles())
        + '<div class="panel stack" style="gap:14px"><h2 class="eyebrow">Members by region</h2>' + bars([("National Capital Region", 12, 12), ("Central Visayas", 4, 12), ("CALABARZON", 4, 12), ("Western Visayas", 3, 12), ("Davao Region", 1, 12)]) + "</div>"
        + section("Members", '<div class="panel" style="padding:0;overflow:hidden">' + table(["Member ID", "Name", "Status", "Region", "Year", "Committee", "Department"], rows) + "</div>", meta="24 matching · page 1")
        + "</div>"
    )
    return officer_board("directory", "Directory", content, "officer", OFFICER_LINKS, height=1300)


def committees() -> str:
    def roster(name, code, members):
        items = "".join(
            f'<li class="row" style="justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--line-soft)"><span class="row" style="gap:14px">{mono(mid)}<span style="color:var(--ink)">{esc(n)}</span></span>{sbadge(st)}</li>'
            for mid, n, st in members
        )
        c = f'<span class="mono small muted">{esc(code)}</span>' if code else ""
        return (
            f'<section class="panel stack" style="gap:12px;padding:0;overflow:hidden"><div class="row" style="gap:12px;padding:16px 16px 0"><h2 class="h2">{esc(name)}</h2>{c}<span class="small muted" style="margin-left:auto">{len(members)} members</span></div>'
            f'<ul style="margin:0;padding:0;list-style:none">{items}</ul></section>'
        )
    content = (
        h1("Committees", "Term 2026-2027 · read-only")
        + '<div class="stack" style="gap:20px">'
        + roster("Community Outreach", "DEMO_CMTE_1", [("2024-0001", "Bautista, Bea", "Active"), ("2025-0003", "Dizon, Dara", "Active"), ("2024-0005", "Flores, Fara", "Active"), ("2025-0009", "Javier, Jaya", "Active")])
        + roster("Scholars' Tech Guild", "DEMO_CMTE_2", [("2024-0002", "Cruz, Caloy", "Active"), ("2026-0004", "Estrada, Eli", "Active"), ("2026-0007", "Hilario, Hana", "Active")])
        + roster("No committee", "", [("2025-0006", "Garcia, Gio", "Renewal pending"), ("2024-0008", "Ignacio, Iking", "Graduated"), ("2026-0010", "Katigbak, Kiko", "Active")])
        + '<p class="small muted">A member may serve on more than one committee (CBL Art. III §5), so these rosters do not add up to the term\'s headcount.</p></div>'
    )
    return officer_board("committees", "Committees", content, "officer", OFFICER_LINKS, height=1150)


def region() -> str:
    rows = [
        ["Bautista, Bea", mono("2024-0001"), sbadge("Active"), "University of the Philippines Diliman", '<a href="#">sample1@start-sys.test</a>', '<a href="#">+63917 000 1001</a>', '<a href="#">Profile</a>'],
        ["Cruz, Caloy", mono("2024-0002"), sbadge("Active"), "Mapúa University", '<a href="#">sample2@start-sys.test</a>', '<a href="#">+63917 000 1002</a>', '<a href="#">Profile</a>'],
        ["Dizon, Dara", mono("2025-0003"), sbadge("Active"), "University of the Philippines Diliman", '<a href="#">sample3@start-sys.test</a>', '<a href="#">+63917 000 1003</a>', '<a href="#">Profile</a>'],
        ["Hilario, Hana", mono("2026-0007"), sbadge("Active"), "Ateneo de Manila University", '<a href="#">sample7@start-sys.test</a>', '<a href="#">+63917 000 1007</a>', "—"],
        ["Ignacio, Iking", mono("2024-0008"), sbadge("Graduated"), "University of the Philippines Diliman", '<a href="#">sample8@start-sys.test</a>', '<a href="#">+63917 000 1008</a>', '<a href="#">Profile</a>'],
    ]
    content = (
        h1("National Capital Region", "Term 2026-2027 · read-only")
        + '<div class="stack" style="gap:28px">'
        + section("Scholars by status", status_tiles(region_only=True))
        + section(
            "Scholars and contact details",
            '<div class="stack" style="gap:14px">'
            + '<div class="row" style="gap:10px;align-items:flex-end"><div class="stack" style="gap:6px;width:320px">' + label("University") + select(["All universities", "University of the Philippines Diliman", "Mapúa University", "Ateneo de Manila University"], extra_class="sm") + "</div>" + button("Filter", "outline sm") + "</div>"
            + '<div class="panel" style="padding:0;overflow:hidden">' + table(["Name", "Member ID", "Status", "University", "Email", "Contact number", "Facebook"], rows) + "</div></div>",
            meta="12 in your region · every view of this list is logged (CBL Art. VIII §6)",
        )
        + "</div>"
    )
    return officer_board("region", "Region", content, "Regional Representative", RR_LINKS, height=1100)


BOARDS = {
    "OfficerDirectory": (directory(), 1440, 1300),
    "OfficerCommittees": (committees(), 1440, 1150),
    "RrRegion": (region(), 1440, 1100),
}
