import { Pipe, PipeTransform } from '@angular/core';

/**
 * A stored code as words: IN_PROGRESS → "In progress", MEDIUM → "Medium".
 * Badges and cells read as words, the same in every table, instead of
 * shouting the database's spelling; the code itself stays what the API
 * sends and filters on. (Angular's titlecase keeps the underscore:
 * "In_progress".)
 */
@Pipe({ name: 'enumLabel', standalone: true })
export class EnumLabelPipe implements PipeTransform {
  transform(code: unknown): string {
    if (code == null) return '';
    const words = String(code).replace(/_+/g, ' ').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
}
