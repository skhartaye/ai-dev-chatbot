import {
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
  PDFSignature,
  PDFName,
} from "pdf-lib";
export function pdfFormFields(doc) {
  if (!doc.catalog.has(PDFName.of("AcroForm"))) return [];
  const form = doc.getForm();
  if (form.hasXFA())
    throw new Error(
      "XFA forms are not supported. Export a standard AcroForm PDF.",
    );
  const pages = doc.getPages();
  return form.getFields().map((field) => {
    const type =
      field instanceof PDFTextField
        ? "text"
        : field instanceof PDFCheckBox
          ? "checkbox"
          : field instanceof PDFDropdown
            ? "dropdown"
            : field instanceof PDFRadioGroup
              ? "radio"
              : field instanceof PDFOptionList
                ? "list"
                : field instanceof PDFSignature
                  ? "signature"
                  : "unsupported";
    const widgets = field.acroField.getWidgets(),
      pageNumbers = pages.flatMap((page, i) =>
        widgets.some(
          (w) =>
            w.P()?.toString() === page.ref.toString() ||
            page.node
              .Annots()
              ?.asArray()
              .some((ref) => doc.context.lookup(ref) === w.dict),
        )
          ? [i + 1]
          : [],
      );
    return {
      name: field.getName(),
      type,
      pages: pageNumbers,
      readOnly: field.isReadOnly(),
      value:
        type === "text"
          ? field.getText() || ""
          : type === "checkbox"
            ? field.isChecked()
            : type === "radio"
              ? (field.getSelected() ?? null)
              : ["dropdown", "list"].includes(type)
                ? field.getSelected()
                : null,
      ...(["radio", "dropdown", "list"].includes(type)
        ? { options: field.getOptions() }
        : {}),
      ...(type === "text"
        ? {
            maxLength: field.getMaxLength() ?? null,
            multiline: field.isMultiline(),
            password: field.isPassword(),
          }
        : {}),
      field,
    };
  });
}
export function formManifest(doc) {
  return pdfFormFields(doc).map(({ field, password, ...data }) => ({
    ...data,
    ...(password ? { password: true, value: null } : {}),
  }));
}
export function fillPdfFields(doc, changes) {
  const entries = pdfFormFields(doc),
    log = [];
  if (
    entries.some((f) => f.type === "signature") ||
    doc.catalog.has(PDFName.of("Perms"))
  )
    throw new Error("Signed or signature-bearing PDFs cannot be edited.");
  for (const change of changes) {
    const entry = entries.find((f) => f.name === change.field);
    if (!entry) throw new Error(`Form field “${change.field}” was not found.`);
    if (entry.readOnly || entry.password || !entry.pages.length)
      throw new Error(
        `Field “${entry.name}” is read-only, password-protected or has no visible widget.`,
      );
    if (JSON.stringify(entry.value) !== JSON.stringify(change.expected))
      throw new Error(
        `Field “${entry.name}” no longer matches the proposed original value. Request the edit again.`,
      );
    const field = entry.field,
      value = change.value;
    if (entry.type === "text") {
      if (
        typeof value !== "string" ||
        (entry.maxLength !== null && value.length > entry.maxLength) ||
        (!entry.multiline && /[\r\n]/.test(value))
      )
        throw new Error(
          `Use text within the length and line limits for “${entry.name}”.`,
        );
      field.setText(value);
      field.setFontSize(0);
    } else if (entry.type === "checkbox") {
      if (typeof value !== "boolean")
        throw new Error("Checkbox values must be true or false.");
      value ? field.check() : field.uncheck();
    } else if (["dropdown", "list", "radio"].includes(entry.type)) {
      const values = Array.isArray(value) ? value : [value];
      if (
        !values.length ||
        values.some((v) => typeof v !== "string" || !entry.options.includes(v))
      )
        throw new Error(`Choose an existing option for “${entry.name}”.`);
      if (entry.type === "radio") {
        if (values.length !== 1) throw new Error("Choose one radio option.");
        field.select(values[0]);
      } else {
        if (values.length > 1 && !field.isMultiselect())
          throw new Error("This field accepts only one option.");
        field.clear();
        field.select(values);
      }
    } else throw new Error(`Field type “${entry.type}” is not supported.`);
    log.push({
      location: `Form field · ${entry.name}`,
      description: `${JSON.stringify(entry.value)} → ${JSON.stringify(value)}`,
      page: entry.pages[0],
    });
  }
  try {
    doc.getForm().updateFieldAppearances();
  } catch {
    throw new Error(
      "A form value could not be rendered with the PDF font. Use supported Latin characters.",
    );
  }
  return log;
}
