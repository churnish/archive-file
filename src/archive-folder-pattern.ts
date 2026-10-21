import { moment } from 'obsidian';

// Splitting on this keeps the captured formats, so even indices are literal text and odd indices are Moment formats
const DATE_TOKEN = /\{([^}]+)\}/;

/** Replaces every `{format}` token in the archive folder template with `date` in that Moment format. */
export function resolveArchiveFolder(
  template: string,
  date: ReturnType<typeof moment>
): string {
  return template
    .split(DATE_TOKEN)
    .map((part, index) => (index % 2 === 0 ? part : date.format(part)))
    .join('');
}

/** Builds a test for whether a folder is one the template resolves to on some date, so a file filed under an earlier month counts as archived. Each token's text must parse strictly in its own format, so `Pile/Projects/Old` does not match `Pile/{YYYY}/{MM}`. */
export function buildArchiveFolderMatcher(
  template: string
): (folderPath: string) => boolean {
  const parts = template.split(DATE_TOKEN);
  const formats = parts.filter((_, index) => index % 2 === 1);
  const source = parts
    .map((part, index) => {
      if (index % 2 === 0) return escapeRegExp(part);
      // A format containing a slash resolves to several folder levels, so only then may its match span one
      return part.includes('/') ? '(.+?)' : '([^/]+)';
    })
    .join('');
  const folderPattern = new RegExp(`^${source}$`);

  return (folderPath) => {
    const match = folderPattern.exec(folderPath);
    return (
      match !== null &&
      formats.every((format, index) =>
        moment(match[index + 1], format, true).isValid()
      )
    );
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
