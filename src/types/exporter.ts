export interface ExporterUserSummary {
  id: string;
  username: string;
  displayName?: string | null;
}

export type ExportPostType = "text" | "image" | "video" | "file" | string;

export interface ExporterPostRecord {
  id: string;
  author: string;
  type: ExportPostType;
  content: string;
  createdAt: string;
  editedAt?: string;
  tags?: string[];
  manifestIds?: string[];
}

export interface ExporterCommentRecord {
  id: string;
  postId: string;
  author: string;
  createdAt: string;
  text: string;
  parentId?: string | null;
}

export interface ExporterMediaRecord {
  id: string;
  filename: string;
  mimeType?: string;
  base64Data: string;
  size: number;
  manifestId?: string;
}

export interface ExporterSelection {
  post: ExporterPostRecord;
  comments?: ExporterCommentRecord[];
  media?: ExporterMediaRecord[];
}

export interface ExportArchiveOptions {
  includePosts: boolean;
  includeComments: boolean;
  includeMedia: boolean;
}

export interface ExporterRequestPayload {
  user: ExporterUserSummary;
  selections: ExporterSelection[];
  options: ExportArchiveOptions;
  requestedAt?: string;
}

export interface ExporterArchiveMetadata {
  generatedAt: string;
  user: ExporterUserSummary;
  options: ExportArchiveOptions;
  postCount: number;
  commentCount: number;
  mediaCount: number;
  fileCount: number;
  uncompressedBytes: number;
  archiveBytes: number;
}
