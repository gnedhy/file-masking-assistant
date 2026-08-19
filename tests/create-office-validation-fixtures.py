from pathlib import Path
import sys
import time
import uno

TASK = "FF3C30F7"
C = f"[[C001@{TASK}]]"
P = f"[[P001@{TASK}]]"
S = f"[[S001@{TASK}]]"


def prop(name, value):
    item = uno.createUnoStruct("com.sun.star.beans.PropertyValue")
    item.Name = name
    item.Value = value
    return item


def connect():
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    for _ in range(30):
        try:
            context = resolver.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")
            service_manager = context.ServiceManager
            return service_manager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("无法连接 LibreOffice 验证进程")


def insert_split(text, cursor, value):
    parts = (value[:6], value[6:13], value[13:])
    for index, part in enumerate(parts):
        cursor.CharWeight = 150 if index == 0 else 100
        text.insertString(cursor, part, False)


def create_docx(desktop, output):
    document = desktop.loadComponentFromURL("private:factory/swriter", "_blank", 0, ())
    text = document.Text
    cursor = text.createTextCursor()
    text.insertString(cursor, "跨格式还原验证\n客户：", False)
    insert_split(text, cursor, C)
    text.insertString(cursor, "\n产品：" + P + "\n负责人：" + S + "\n", False)

    table = document.createInstance("com.sun.star.text.TextTable")
    table.initialize(2, 2)
    text.insertTextContent(cursor, table, False)
    table.getCellByName("A1").String = "字段"
    table.getCellByName("B1").String = "代号"
    table.getCellByName("A2").String = "客户"
    table.getCellByName("B2").String = C

    text.insertControlCharacter(cursor, 0, False)
    frame = document.createInstance("com.sun.star.text.TextFrame")
    frame.Width = 7000
    frame.Height = 1200
    text.insertTextContent(cursor, frame, False)
    frame.Text.String = "文本框负责人：" + S

    page_styles = document.StyleFamilies.getByName("PageStyles")
    default_page = page_styles.getByIndex(0)
    default_page.HeaderIsOn = True
    default_page.FooterIsOn = True
    default_page.HeaderText.String = "客户抬头 " + C
    default_page.FooterText.String = "产品页脚 " + P

    document.storeAsURL(
        uno.systemPathToFileUrl(str(output)),
        (prop("FilterName", "Office Open XML Text"), prop("Overwrite", True)),
    )
    try:
        document.close(True)
    except Exception:
        pass


def add_text_shape(document, page, x, y, width, height, text_value):
    shape = document.createInstance("com.sun.star.drawing.TextShape")
    shape.Position = uno.createUnoStruct("com.sun.star.awt.Point", x, y)
    shape.Size = uno.createUnoStruct("com.sun.star.awt.Size", width, height)
    page.add(shape)
    shape.String = text_value
    return shape


def create_pptx(desktop, output):
    document = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, ())
    slide = document.DrawPages.getByIndex(0)
    add_text_shape(document, slide, 1200, 900, 23000, 1800, "跨格式还原验证")
    split_shape = add_text_shape(document, slide, 1200, 3300, 23000, 1800, "客户：")
    shape_text = split_shape.Text
    cursor = shape_text.createTextCursor()
    cursor.gotoEnd(False)
    insert_split(shape_text, cursor, C)
    add_text_shape(document, slide, 1200, 5600, 23000, 1800, "产品：" + P)
    add_text_shape(document, slide, 1200, 7900, 23000, 1800, "负责人：" + S + "；重复客户：" + C)

    notes = slide.getNotesPage()
    add_text_shape(document, notes, 1200, 1200, 23000, 1800, "演讲者备注负责人：" + S)

    document.storeAsURL(
        uno.systemPathToFileUrl(str(output)),
        (prop("FilterName", "Impress MS PowerPoint 2007 XML"), prop("Overwrite", True)),
    )
    try:
        document.close(True)
    except Exception:
        pass


def main():
    output_dir = Path(sys.argv[1]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    desktop = connect()
    create_docx(desktop, output_dir / "AI处理结果_跨格式验证.docx")
    create_pptx(desktop, output_dir / "AI处理结果_跨格式验证.pptx")


if __name__ == "__main__":
    main()
