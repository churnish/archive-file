import { moment } from 'obsidian';

/** The part of a Moment date this plugin uses. */
export interface MomentDate {
  format(format: string): string;
  isValid(): boolean;
}

// Obsidian types its `moment` export through the separate `moment` package, which the community directory's review cannot resolve, so every direct call reaches its lint as an error type. Narrowing once here keeps each call typed there too, as Dynamic Views' `formatWithMoment` does.
const createMoment = moment as unknown as (
  input?: string,
  format?: string,
  strict?: boolean
) => MomentDate;

/** The current date and time. */
export function currentMoment(): MomentDate {
  return createMoment();
}

// Splitting on this keeps the captured formats, so even indices are literal text and odd indices are Moment formats
const DATE_TOKEN = /\{([^}]+)\}/;

/** Replaces every `{format}` token in the archive folder template with `date` in that Moment format. */
export function resolveArchiveFolder(
  template: string,
  date: MomentDate
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
        createMoment(match[index + 1], format, true).isValid()
      )
    );
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
