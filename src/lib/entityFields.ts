import type { ErField } from '@/lib/types';

export function createDefaultErField(): ErField {
  return {
    name: '',
    dataType: '',
    isPrimaryKey: false,
    isForeignKey: false,
    isNotNull: false,
    isUnique: false,
  };
}

function formatMermaidReferenceTarget(field: ErField): string | null {
  const referencesTable = field.referencesTable?.trim();
  if (!referencesTable) {
    return null;
  }

  const referencesField = field.referencesField?.trim();
  return referencesField ? `${referencesTable}.${referencesField}` : referencesTable;
}

export function stringifyErField(field: ErField): string {
  const segments: string[] = [];
  const normalizedName = field.name.trim();
  const normalizedType = field.dataType.trim();
  if (normalizedType) {
    segments.push(`${normalizedName || 'field'}: ${normalizedType}`);
  } else {
    segments.push(normalizedName || 'field');
  }
  if (field.isPrimaryKey) segments.push('PK');
  if (field.isForeignKey) segments.push('FK');
  if (field.isNotNull) segments.push('NN');
  if (field.isUnique) segments.push('UNIQUE');
  return segments.join(' ').trim();
}

export function stringifyMermaidErField(field: ErField): string {
  const segments: string[] = [];
  const normalizedName = field.name.trim() || 'field';
  const normalizedType = field.dataType.trim() || 'string';

  segments.push(normalizedType, normalizedName);
  if (field.isPrimaryKey) segments.push('PK');
  if (field.isForeignKey) segments.push('FK');
  if (field.isUnique) segments.push('UK');
  if (field.isNotNull) segments.push('NN');
  const referenceTarget = formatMermaidReferenceTarget(field);
  if (referenceTarget) {
    segments.push('REFERENCES', referenceTarget);
  }

  return segments.join(' ').trim();
}
