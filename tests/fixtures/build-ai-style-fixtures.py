# Build the AI-style fixtures (python-pptx 1.0.2). Marker AAAA is swapped for the real one at test time.
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

m = ["客户-AAAA-01", "客户-AAAA-02", "产品-AAAA-01", "产品-AAAA-02", "人员-AAAA-01", "人员-AAAA-02"]
c1, c2 = [k for k in m if k.startswith("客户")][:2]
p1, p2 = [k for k in m if k.startswith("产品")][:2]
s1, s2 = [k for k in m if k.startswith("人员")][:2]

def deck(chart=False, core_title=False, group=False):
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = f"{c1} 销售经营分析"
    s.placeholders[1].text = f"汇报人：{s1}"
    s.notes_slide.notes_text_frame.text = f"开场先感谢 {c1} 和 {c2} 的支持。"

    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "核心结论"
    tf = s.placeholders[1].text_frame
    tf.text = f"{c1} 贡献最大，主力产品 {p1}"
    para = tf.add_paragraph()
    r = para.add_run(); r.text = "增长点："
    r = para.add_run(); r.text = c2; r.font.bold = True
    r = para.add_run(); r.text = f"，负责人 {s2}"

    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "客户明细"
    rows = [("客户", "产品", "负责人"), (c1, p1, s1), (c2, p2, s2)]
    t = s.shapes.add_table(3, 3, Inches(0.5), Inches(1.5), Inches(9), Inches(1.5)).table
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            t.cell(i, j).text = v
            t.cell(i, j).text_frame.paragraphs[0].runs[0].font.size = Pt(14)

    if group:
        g = s.shapes.add_group_shape()
        g.shapes.add_textbox(Inches(0.5), Inches(4), Inches(4), Inches(0.5)).text_frame.text = f"备注：{p2} 需补货"

    if chart:
        s = prs.slides.add_slide(prs.slide_layouts[5])
        s.shapes.title.text = "客户销售额"
        data = CategoryChartData()
        data.categories = [c1, c2]
        data.add_series("销售额", (128000, 86000))
        s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.5), Inches(8), Inches(5), data)

    if core_title:
        prs.core_properties.title = f"{c1} 销售经营分析"
    return prs

deck(group=True, chart=True).save("tests/fixtures/ai-style-deck.pptx")

style = "<style>body{font-family:system-ui;margin:40px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}.kpi{color:#2343aa}</style>"
table = f"<table><thead><tr><th>客户</th><th>产品</th><th>负责人</th></tr></thead><tbody><tr><td>{c1}</td><td>{p1}</td><td>{s1}</td></tr><tr><td>{c2}</td><td>{p2}</td><td>{s2}</td></tr></tbody></table>"
body = f"<h1>{c1} 销售经营分析</h1><p class=\"kpi\">本期 <strong>{c1}</strong> 贡献最大，增长点是 <em>{c2}</em>。</p>{table}<ul><li>{p1} 主力产品</li><li>负责人：{s1}、{s2}</li></ul>"

def html(head_extra="", body_extra="", title=f"{c1} 销售经营分析"):
    return f"<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{title}</title>{style}{head_extra}</head><body>{body}{body_extra}</body></html>"

open("tests/fixtures/ai-style-report.html", "w", encoding="utf-8").write(html(body_extra=f"<img alt=\"{c1} 销售趋势图\" src=\"data:image/png;base64,iVBORw0KGgo=\"><abbr title=\"{c2}\">客户二</abbr>"))
chart_js = "<script src=\"https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js\"></script>"
chart_body = f"<canvas id=\"c\"></canvas><script>new Chart(document.getElementById('c'),{{type:'bar',data:{{labels:['{c1}','{c2}'],datasets:[{{label:'销售额',data:[128000,86000]}}]}}}});</script>"
# Same chart but with no aliases inside the script: labels read from the table instead.
clean_chart = "<canvas id=\"c\"></canvas><script>const rows=[...document.querySelectorAll('tbody tr')];new Chart(document.getElementById('c'),{type:'bar',data:{labels:rows.map(r=>r.cells[0].textContent),datasets:[{label:'销售额',data:[128000,86000]}]}});</script>"
print("ok", c1, c2, p1, p2, s1, s2)
