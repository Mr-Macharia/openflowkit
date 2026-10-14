import type { Point2d, Size2d } from '../geometry/types';

export const WIDGET_KINDS = [
  'button', 'input', 'search', 'checkbox', 'radio', 'toggle', 'dropdown', 'slider',
  'navbar', 'tabs', 'image', 'avatar', 'heading', 'paragraph', 'divider', 'link',
  'textarea', 'stepper', 'badge', 'progress', 'breadcrumbs', 'pagination', 'rating',
  'card', 'list', 'alert', 'menu', 'tooltip', 'accordion', 'datepicker', 'sidebar',
  'segmented', 'tabbar', 'statusbar', 'fab',
] as const;

export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const WIDGET_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;
type WidgetSeverity = (typeof WIDGET_SEVERITIES)[number];
/** `primary` fills a button; a severity tints an alert or a badge. */
export type WidgetVariant = 'primary' | WidgetSeverity;

/** Which state a control carries. The style bar and the DSL read this one table. */
type WidgetStateKey = 'checked' | 'value' | 'active' | 'variant';

interface WidgetSpec {
  readonly name: string;
  readonly label: string;
  readonly size: Size2d;
  /** Its label is `A | B | C`: one entry per item. */
  readonly items?: true;
  readonly state?: WidgetStateKey;
  /** Keeps its own width in a frame; everything else spans the column. */
  readonly intrinsic?: true;
  /** What a fresh one shows, so an inserted widget reads at a glance. */
  readonly initial?: { readonly checked?: boolean; readonly value?: number; readonly active?: number; readonly variant?: WidgetVariant };
}

export const WIDGETS: Readonly<Record<WidgetKind, WidgetSpec>> = {
  button: { name: 'Button', label: 'Button', size: { width: 120, height: 40 }, state: 'variant' },
  input: { name: 'Input', label: 'Email', size: { width: 240, height: 40 } },
  search: { name: 'Search', label: 'Search', size: { width: 240, height: 40 } },
  checkbox: { name: 'Checkbox', label: 'Remember me', size: { width: 180, height: 24 }, state: 'checked', initial: { checked: true } },
  radio: { name: 'Radio', label: 'Option', size: { width: 160, height: 24 }, state: 'checked', initial: { checked: true } },
  toggle: { name: 'Toggle', label: 'Toggle', size: { width: 160, height: 28 }, state: 'checked', initial: { checked: true } },
  dropdown: { name: 'Dropdown', label: 'Select an option', size: { width: 240, height: 40 } },
  slider: { name: 'Slider', label: '', size: { width: 240, height: 24 }, state: 'value', initial: { value: 0.6 } },
  navbar: { name: 'Navigation bar', label: 'Home | About | Contact', size: { width: 400, height: 56 }, items: true, state: 'active', initial: { active: 0 } },
  tabs: { name: 'Tabs', label: 'Overview | Reports | Settings', size: { width: 360, height: 40 }, items: true, state: 'active', initial: { active: 0 } },
  image: { name: 'Image', label: '', size: { width: 240, height: 160 } },
  avatar: { name: 'Avatar', label: '', size: { width: 48, height: 48 }, intrinsic: true },
  heading: { name: 'Heading', label: 'Heading', size: { width: 240, height: 36 } },
  paragraph: { name: 'Paragraph', label: 'A short paragraph of body copy that explains what this section is for.', size: { width: 280, height: 64 } },
  divider: { name: 'Divider', label: '', size: { width: 280, height: 12 } },
  link: { name: 'Link', label: 'Learn more', size: { width: 100, height: 24 }, intrinsic: true },
  textarea: { name: 'Text area', label: 'Write a message…', size: { width: 280, height: 100 } },
  stepper: { name: 'Stepper', label: 'Cart | Shipping | Payment', size: { width: 360, height: 52 }, items: true, state: 'active', initial: { active: 1 } },
  badge: { name: 'Badge', label: 'New', size: { width: 56, height: 24 }, intrinsic: true, state: 'variant', initial: { variant: 'info' } },
  progress: { name: 'Progress bar', label: '', size: { width: 240, height: 10 }, state: 'value', initial: { value: 0.6 } },
  breadcrumbs: { name: 'Breadcrumbs', label: 'Home | Projects | Report', size: { width: 280, height: 24 }, items: true, state: 'active', initial: { active: 2 } },
  pagination: { name: 'Pagination', label: '1 | 2 | 3 | 4 | 5', size: { width: 280, height: 36 }, items: true, state: 'active', initial: { active: 0 } },
  rating: { name: 'Rating', label: '', size: { width: 136, height: 24 }, intrinsic: true, state: 'value', initial: { value: 0.8 } },
  card: { name: 'Card', label: 'Card title', size: { width: 240, height: 200 } },
  list: { name: 'List', label: 'First item | Second item | Third item', size: { width: 240, height: 132 }, items: true, state: 'active' },
  alert: { name: 'Alert', label: 'Something needs your attention', size: { width: 320, height: 48 }, state: 'variant', initial: { variant: 'info' } },
  menu: { name: 'Menu', label: 'Profile | Settings | Sign out', size: { width: 180, height: 124 }, intrinsic: true, items: true, state: 'active' },
  tooltip: { name: 'Tooltip', label: 'Tooltip text', size: { width: 140, height: 44 }, intrinsic: true },
  accordion: { name: 'Accordion', label: 'First section | Second section | Third section', size: { width: 280, height: 176 }, items: true, state: 'active', initial: { active: 0 } },
  datepicker: { name: 'Date picker', label: 'September 2026', size: { width: 280, height: 264 }, intrinsic: true, state: 'active', initial: { active: 12 } },
  sidebar: { name: 'Sidebar', label: 'Dashboard | Projects | Team | Settings', size: { width: 200, height: 320 }, intrinsic: true, items: true, state: 'active', initial: { active: 0 } },
  segmented: { name: 'Segmented control', label: 'Day | Week | Month', size: { width: 280, height: 36 }, items: true, state: 'active', initial: { active: 0 } },
  tabbar: { name: 'Tab bar', label: 'Home | Search | Profile', size: { width: 360, height: 56 }, items: true, state: 'active', initial: { active: 0 } },
  statusbar: { name: 'Status bar', label: '9:41', size: { width: 360, height: 24 } },
  fab: { name: 'Floating button', label: '', size: { width: 56, height: 56 }, intrinsic: true },
};

export function isWidgetKind(value: unknown): value is WidgetKind {
  return typeof value === 'string' && value in WIDGETS;
}

/** Colour roles, resolved per theme by `resolveWidgetInks`. */
export type WidgetInk =
  | 'ink' | 'muted' | 'faint' // text and marks sitting on the backdrop
  | 'text' | 'subtle' // text inside the widget's own fill
  | 'line' | 'surface' | 'accent' | 'onAccent' | WidgetSeverity;

export interface Paint {
  readonly fill?: WidgetInk;
  readonly stroke?: WidgetInk;
  readonly strokeWidth?: number;
  /** Multiplies both fill and stroke alpha. */
  readonly opacity?: number;
}

export type WidgetPrimitive =
  | ({ readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly radius: number } & Paint)
  | ({ readonly kind: 'circle'; readonly x: number; readonly y: number; readonly radius: number } & Paint)
  | ({ readonly kind: 'path'; readonly points: readonly Point2d[]; readonly closed: boolean } & Paint)
  | {
      readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string;
      readonly ink: WidgetInk; readonly size: number; readonly weight: 400 | 500 | 600 | 700;
      /** Horizontal anchor; `y` is always the vertical middle of the line. */
      readonly anchor: 'start' | 'middle' | 'end';
    };

export interface WidgetPresentation {
  readonly widget: WidgetKind;
  readonly label: string;
  readonly items: readonly string[];
  readonly checked: boolean;
  /** 0–1: slider, progress, rating. */
  readonly value: number;
  /** Selected item (or day of the month for a date picker); -1 for none. */
  readonly active: number;
  readonly variant: WidgetVariant | null;
  readonly primitives: readonly WidgetPrimitive[];
}

export interface WidgetInkPaint { readonly color: string; readonly alpha: number }
