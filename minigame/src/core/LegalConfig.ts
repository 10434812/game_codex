/**
 * 正式法律文档配置（原 utils/legal-config.js）。
 *
 * 必须由实际运营方在上线前填入真实主体与文档内容；`configured: false` 时
 * isReady() 恒为 false，登录与公开使用都会被 PrivacyConsent 挡住。
 */

export interface LegalSection {
  heading: string;
  text: string;
}

export interface LegalConfig {
  configured: boolean;
  operatorName: string;
  contact: string;
  effectiveDate: string;
  privacyVersion: string;
  agreementVersion: string;
  privacySections: LegalSection[];
  agreementSections: LegalSection[];
}

import {legalContent} from './LegalContent';
export const legalConfig: LegalConfig = legalContent;

const REQUIRED_TEXT_KEYS: (keyof LegalConfig)[] = [
  'operatorName',
  'contact',
  'effectiveDate',
  'privacyVersion',
  'agreementVersion',
];

const REQUIRED_SECTION_KEYS: (keyof LegalConfig)[] = ['privacySections', 'agreementSections'];

function hasEffectiveDate(): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(legalConfig.effectiveDate)) {
    return false;
  }
  const date = new Date(`${legalConfig.effectiveDate}T00:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) {
    return false;
  }
  const chinaDate = new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return chinaDate === legalConfig.effectiveDate && date.getTime() <= Date.now();
}

function hasValidSections(sections: unknown): boolean {
  return (
    Array.isArray(sections) &&
    sections.length > 0 &&
    sections.every(
      (section) =>
        !!section &&
        typeof section.heading === 'string' &&
        section.heading.trim() !== '' &&
        typeof section.text === 'string' &&
        section.text.trim() !== ''
    )
  );
}

export function isReady(): boolean {
  return (
    legalConfig.configured === true &&
    hasEffectiveDate() &&
    REQUIRED_TEXT_KEYS.every(
      (key) => typeof legalConfig[key] === 'string' && (legalConfig[key] as string).trim() !== ''
    ) &&
    REQUIRED_SECTION_KEYS.every((key) => hasValidSections(legalConfig[key]))
  );
}
