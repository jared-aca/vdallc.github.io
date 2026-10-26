export type ContentType = "page" | "blog" | "service";
export type Seo = {
  title: string;
  description: string;
  canonical: string;
  socialTitle: string;
  socialDescription: string;
  socialImage: string;
  socialImageAlt: string;
  noindex: boolean;
  nofollow: boolean;
  excludeFromSitemap: boolean;
};
export type Content = {
  path: string;
  type: ContentType;
  title: string;
  excerpt: string;
  body: string;
  image: string;
  imageAlt: string;
  category: string;
  date: string;
  seo: Seo;
  structuredData?: Record<string, unknown>[];
};
export type SeedPage = { content: Content; html: string };
export type Revision = {
  id: string;
  at: string;
  action: string;
  content: Content;
};
export type RecordEntry = {
  draft: Content;
  published: Content | null;
  revision: number;
  updatedAt: string;
  versions: Revision[];
};
export type ContentSummary = {
  path: string;
  type: ContentType;
  title: string;
  status: "published" | "draft";
  hasChanges: boolean;
  revision: number;
  updatedAt: string;
  noindex: boolean;
  seoComplete: boolean;
};
export class CmsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
