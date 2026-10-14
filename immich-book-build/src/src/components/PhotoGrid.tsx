import { useState, useEffect, useMemo, useRef } from "react";
import {
  getAlbumInfo,
  type AlbumResponseDto,
  type AssetResponseDto,
} from "@immich/sdk";
import {
  PDFViewer,
  Document,
  Page,
  Image,
  View,
  Text,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import {
  calculatePageLayout,
  getDefaultPageAlignment,
  PAGE_SIZES,
  type PageAlignment,
} from "../utils/pageLayout";
import type { ImmichConfig } from "./ConnectionForm";
import roboto400 from "@fontsource/roboto/files/roboto-latin-400-normal.woff?url";
import roboto500 from "@fontsource/roboto/files/roboto-latin-500-normal.woff?url";
import robotoCyrillic400 from "@fontsource/roboto/files/roboto-cyrillic-400-normal.woff?url";
import robotoCyrillic500 from "@fontsource/roboto/files/roboto-cyrillic-500-normal.woff?url";
import Icon from "@mdi/react";
import {
  mdiFormatAlignLeft,
  mdiFormatAlignCenter,
  mdiFormatAlignRight,
} from "@mdi/js";

// функция расчёта размеров фото
const getAssetAspectRatio = (asset: any): number => {
  const width =
    asset?.exifInfo?.exifImageWidth ||
    asset?.width ||
    asset?.thumbhashWidth ||
    1;
  const height =
    asset?.exifInfo?.exifImageHeight ||
    asset?.height ||
    asset?.thumbhashHeight ||
    1;

  let ratio = width / height;

  const orientation = String(asset?.exifInfo?.orientation || "");
  if (["5", "6", "7", "8"].includes(orientation)) {
    ratio = height / width;
  }

  return ratio > 0 ? ratio : 1;
};

// Register Roboto font for PDF using local bundled files
Font.register({
  family: "RobotoLatin",
  fonts: [
    { src: roboto400, fontWeight: 400 },
    { src: roboto500, fontWeight: 500 },
  ],
});

Font.register({
  family: "Roboto",
  fonts: [
    { src: roboto400, fontWeight: 400 },
    { src: roboto500, fontWeight: 500 },
  ],
});

Font.register({
  family: "RobotoCyrillic",
  fonts: [
    { src: robotoCyrillic400, fontWeight: 400 },
    { src: robotoCyrillic500, fontWeight: 500 },
  ],
});

interface PhotoGridProps {
  immichConfig: ImmichConfig;
  album: AlbumResponseDto;
  onBack: () => void;
}

type Position = "bottom" | "top" | "left" | "right";

interface GlobalConfig {
  // Page settings
  pageSize: "A4" | "LETTER" | "A3" | "CUSTOM";
  orientation: "portrait" | "landscape";
  pageWidth: number;
  pageHeight: number;
  margin: number;
  combinePages: boolean;

  // Layout settings
  rowHeight: number;
  spacing: number;
  filterVideos: boolean;

  // Display settings
  showDates: boolean;
  showDescriptions: boolean;
  fontSize: number;
}

interface AlbumConfig extends GlobalConfig {
  // Customizations (album-specific only)
  customAspectRatios: Record<string, number>;
  customOrdering: string[] | null;
  descriptionPositions: Record<string, Position>;
  pageAlignments: Record<number, PageAlignment>;
  pageAlignmentVersion: number;
}

const PAGE_ALIGNMENT_VERSION = 1;

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  pageSize: "CUSTOM",
  orientation: "portrait",
  pageWidth: 2515,
  pageHeight: 3260,
  margin: 118,
  combinePages: true,
  rowHeight: 994,
  spacing: 20,
  filterVideos: true,
  showDates: true,
  showDescriptions: true,
  fontSize: 12,
};

// Helper functions for config persistence
function loadGlobalConfig(): GlobalConfig {
  try {
    const stored = localStorage.getItem("immich-book-global-config");
    if (stored) {
      return { ...DEFAULT_GLOBAL_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error("Failed to load global config:", e);
  }
  return DEFAULT_GLOBAL_CONFIG;
}

function saveGlobalConfig(config: GlobalConfig) {
  try {
    localStorage.setItem("immich-book-global-config", JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save global config:", e);
  }
}

function loadAlbumConfig(albumId: string): AlbumConfig {
  const globalConfig = loadGlobalConfig();

  try {
    const stored = localStorage.getItem(`immich-book-config-${albumId}`);
    if (stored) {
      const albumSpecific = JSON.parse(stored);
      const pageAlignments =
        albumSpecific.pageAlignmentVersion === PAGE_ALIGNMENT_VERSION
          ? albumSpecific.pageAlignments || {}
          : {};
      return {
        ...globalConfig,
        customAspectRatios: {},
        customOrdering: null,
        descriptionPositions: {},
        pageAlignments,
        pageAlignmentVersion: PAGE_ALIGNMENT_VERSION,
        ...albumSpecific,
        pageAlignments,
        pageAlignmentVersion: PAGE_ALIGNMENT_VERSION,
      };
    }
  } catch (e) {
    console.error("Failed to load album config:", e);
  }

  return {
    ...globalConfig,
    customAspectRatios: {},
    customOrdering: null,
    descriptionPositions: {},
    pageAlignments: {},
    pageAlignmentVersion: PAGE_ALIGNMENT_VERSION,
  };
}

function saveAlbumConfig(albumId: string, config: AlbumConfig) {
  try {
    localStorage.setItem(
      `immich-book-config-${albumId}`,
      JSON.stringify(config),
    );

    // Also update global config with page and layout settings
    const globalConfig: GlobalConfig = {
      pageSize: config.pageSize,
      orientation: config.orientation,
      pageWidth: config.pageWidth,
      pageHeight: config.pageHeight,
      margin: config.margin,
      combinePages: config.combinePages,
      rowHeight: config.rowHeight,
      spacing: config.spacing,
      filterVideos: config.filterVideos,
      showDates: config.showDates,
      showDescriptions: config.showDescriptions,
      fontSize: config.fontSize,
    };
    saveGlobalConfig(globalConfig);
  } catch (e) {
    console.error("Failed to save album config:", e);
  }
}

// Convert 300 DPI pixels to 72 DPI points for PDF
// At 300 DPI: 1 inch = 300 pixels
// At 72 DPI: 1 inch = 72 points
// Conversion: points = pixels * (72/300)
const toPoints = (pixels: number) => pixels * (72 / 300);

// Static styles for the PDF
const staticStyles = StyleSheet.create({
  page: {
    backgroundColor: "white",
  },
  photoContainer: {
    position: "absolute",
  },
  photo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
});

// Dynamic styles based on font size
const createDynamicStyles = (fontSize: number) => {
  const basePadding = fontSize * 0.67;

  return {
    // Common text style
    text: {
      color: "black",
      fontSize: fontSize,
      fontFamily: "Roboto",
      lineHeight: 1,
      letterSpacing: 0.2,
    },
    // Date overlay styles
    dateOverlay: {
      backgroundColor: "rgba(255, 255, 255, 0.7)",
      paddingHorizontal: basePadding,
      paddingVertical: basePadding * 0.5,
      borderRadius: basePadding * 0.5,
    },
    // Description styles
    descriptionOverlay: {
      backgroundColor: "rgba(255, 255, 255, 0.7)",
      color: "black",
      fontSize: fontSize,
      padding: basePadding,
      fontFamily: "Roboto",
      lineHeight: 1,
      letterSpacing: 0.2,
    },
    descriptionSide: {
      padding: basePadding,
      display: "flex",
      justifyContent: "center",
      backgroundColor: "#F3F4F6",
    },
  };
};

// Web preview styles
const createWebStyles = (fontSize: number) => {
  const basePadding = fontSize * 0.67;

  return {
    date: {
      hyphens: "none" as const,
      wordWrap: "break-word" as const,
      fontSize: `${fontSize}px`,
      padding: `${basePadding * 0.5}px ${basePadding}px`,
      borderRadius: `${basePadding * 0.5}px`,
      lineHeight: 1,
    },
    description: {
      hyphens: "none" as const,
      wordWrap: "break-word" as const,
      fontSize: `${fontSize}px`,
      padding: `${basePadding}px`,
      lineHeight: 1,
    },
    descriptionSide: {
      hyphens: "none" as const,
      wordWrap: "break-word" as const,
      fontSize: `${fontSize}px`,
      padding: `${basePadding}px`,
      lineHeight: 1,
    },
  };
};

function PhotoGrid({ immichConfig, album, onBack }: PhotoGridProps) {
  const [assets, setAssets] = useState<AssetResponseDto[]>([]);
  const [albumDescription, setAlbumDescription] = useState(
    album.description || "",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "pdf">("preview");
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [pdfPreparation, setPdfPreparation] = useState({ done: 0, total: 0 });
  const [pdfPreparingFile, setPdfPreparingFile] = useState("");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfImageSources, setPdfImageSources] = useState<Map<string, string>>(
    () => new Map(),
  );
  const pdfImageSourcesRef = useRef(new Map<string, string>());

  // Load config on mount
  const initialConfig = useMemo(() => loadAlbumConfig(album.id), [album.id]);

  // Page settings
  const [pageSize, _setPageSize] = useState<"A4" | "LETTER" | "A3" | "CUSTOM">(
    initialConfig.pageSize,
  );
  const [orientation, _setOrientation] = useState<"portrait" | "landscape">(
    initialConfig.orientation,
  );
  const [pageWidth, setPageWidth] = useState(initialConfig.pageWidth);
  const [pageHeight, setPageHeight] = useState(initialConfig.pageHeight);
  const [margin, setMargin] = useState(initialConfig.margin);
  const [combinePages, setCombinePages] = useState(initialConfig.combinePages);

  // Layout settings
  const [rowHeight, setRowHeight] = useState(initialConfig.rowHeight);
  const [spacing, setSpacing] = useState(initialConfig.spacing);
  const [filterVideos, setFilterVideos] = useState(initialConfig.filterVideos);

  // Validation helpers
  const isPageWidthValid = pageWidth >= 1000 && pageWidth <= 10000;
  const isPageHeightValid = pageHeight >= 1000 && pageHeight <= 10000;
  const isMarginValid = margin >= 0 && margin <= pageWidth / 2;
  const isRowHeightValid = rowHeight >= 300 && rowHeight <= pageHeight;
  const isSpacingValid = spacing >= 0 && spacing <= 100;

  // Clamped values for use in layout calculations (prevent crashes from invalid values)
  const validPageWidth = isPageWidthValid
    ? pageWidth
    : Math.max(1000, Math.min(10000, pageWidth));
  const validPageHeight = isPageHeightValid
    ? pageHeight
    : Math.max(1000, Math.min(10000, pageHeight));
  const validMargin = isMarginValid
    ? margin
    : Math.max(0, Math.min(validPageWidth / 2, margin));
  const validRowHeight = isRowHeightValid
    ? rowHeight
    : Math.max(300, Math.min(validPageHeight, rowHeight));
  const validSpacing = isSpacingValid
    ? spacing
    : Math.max(0, Math.min(100, spacing));

  // Display settings
  const [showDates, setShowDates] = useState(initialConfig.showDates);
  const [showDescriptions, setShowDescriptions] = useState(
    initialConfig.showDescriptions,
  );
  const [includeCover, setIncludeCover] = useState(true);
  const [fontSize, setFontSize] = useState(initialConfig.fontSize);

  // Create dynamic styles based on current fontSize
  const pdfStyles = useMemo(() => createDynamicStyles(fontSize), [fontSize]);
  const webStyles = useMemo(() => createWebStyles(fontSize), [fontSize]);

  useEffect(() => {
    return () => {
      for (const source of pdfImageSourcesRef.current.values()) {
        if (source.startsWith("blob:")) {
          URL.revokeObjectURL(source);
        }
      }
    };
  }, []);

  // Customizations
  const [customAspectRatios, setCustomAspectRatios] = useState<
    Map<string, number>
  >(() => new Map(Object.entries(initialConfig.customAspectRatios)));
  const [customOrdering, setCustomOrdering] = useState<string[] | null>(
    initialConfig.customOrdering,
  );
  const [descriptionPositions, setDescriptionPositions] = useState<
    Map<string, Position>
  >(() => new Map(Object.entries(initialConfig.descriptionPositions)));
  const [pageAlignments, setPageAlignments] = useState<
    Map<number, PageAlignment>
  >(
    () =>
      new Map(
        Object.entries(initialConfig.pageAlignments).map(([k, v]) => [
          Number(k),
          v,
        ]),
      ),
  );

  // Drag state for reordering
  const [reorderDragState, setReorderDragState] = useState<{
    draggedAssetId: string;
    draggedIndex: number;
  } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Drag state for aspect ratio adjustment
  const [aspectDragState, setAspectDragState] = useState<{
    assetId: string;
    edge: "left" | "right";
    startX: number;
    originalAspectRatio: number;
    originalX: number;
    originalWidth: number;
  } | null>(null);

  // Update page dimensions when size or orientation changes
  useEffect(() => {
    if (pageSize !== "CUSTOM") {
      const dimensions = PAGE_SIZES[pageSize][orientation];
      setPageWidth(dimensions.width);
      setPageHeight(dimensions.height);
    }
  }, [pageSize, orientation]);

  useEffect(() => {
    loadAlbumAssets();

    // Clean up old localStorage keys (migration)
    localStorage.removeItem(`immich-book-aspect-ratios-${album.id}`);
    localStorage.removeItem(`immich-book-ordering-${album.id}`);
    localStorage.removeItem(`immich-book-description-positions-${album.id}`);
  }, [album.id]);

  // Save config to localStorage whenever it changes (with clamped values)
  useEffect(() => {
    // Only save if all values are valid
    if (
      !isPageWidthValid ||
      !isPageHeightValid ||
      !isMarginValid ||
      !isRowHeightValid ||
      !isSpacingValid
    ) {
      return;
    }

    const config: AlbumConfig = {
      pageSize,
      orientation,
      pageWidth,
      pageHeight,
      margin,
      combinePages,
      rowHeight,
      spacing,
      filterVideos,
      showDates,
      showDescriptions,
      fontSize,
      customAspectRatios: Object.fromEntries(customAspectRatios),
      customOrdering,
      descriptionPositions: Object.fromEntries(descriptionPositions),
      pageAlignments: Object.fromEntries(pageAlignments),
      pageAlignmentVersion: PAGE_ALIGNMENT_VERSION,
    };
    saveAlbumConfig(album.id, config);
  }, [
    album.id,
    pageSize,
    orientation,
    pageWidth,
    pageHeight,
    margin,
    combinePages,
    rowHeight,
    spacing,
    filterVideos,
    showDates,
    showDescriptions,
    fontSize,
    customAspectRatios,
    customOrdering,
    descriptionPositions,
    pageAlignments,
    isPageWidthValid,
    isPageHeightValid,
    isMarginValid,
    isRowHeightValid,
    isSpacingValid,
  ]);


const loadAlbumAssets = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const albumData = await getAlbumInfo({ id: album.id });
      setAlbumDescription(albumData.description || album.description || "");

      let rawAssets = (albumData as any)?.assets;

      // Immich v3 returns album metadata without its assets.
      if (!rawAssets || !Array.isArray(rawAssets)) {
        const assetsUrl = `${immichConfig.baseUrl.replace(/\/+$/, "")}/search/metadata`;
        const albumAssets: AssetResponseDto[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | undefined;

        do {
          const response = await fetch(assetsUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": immichConfig.apiKey,
              Accept: "application/json",
            },
            body: JSON.stringify({
              albumIds: [album.id],
              size: 1000,
              withExif: true,
              ...(cursor ? { cursor } : {}),
            }),
          });

          if (!response.ok) {
            throw new Error(
              `Failed to fetch album assets: HTTP ${response.status}`,
            );
          }

          const searchResult = await response.json();
          const assetPage = searchResult?.assets;
          if (!Array.isArray(assetPage?.items)) {
            throw new Error("Immich returned an unexpected album assets response");
          }

          albumAssets.push(...assetPage.items);
          const nextCursor = assetPage.nextCursor;
          if (!nextCursor || seenCursors.has(nextCursor)) {
            cursor = undefined;
          } else {
            seenCursors.add(nextCursor);
            cursor = nextCursor;
          }
        } while (cursor);

        rawAssets = albumAssets;
      }

      // Sort assets by creation date ascending
      const sorted = [...rawAssets].sort((a: any, b: any) => {
        return (
          new Date(a.fileCreatedAt).getTime() -
          new Date(b.fileCreatedAt).getTime()
        );
      });
      setAssets(sorted);
    } catch (err) {
      setError((err as Error).message || "Failed to load album assets");
    } finally {
      setIsLoading(false);
    }
  };

  const preparePdf = async () => {
    const images = filteredAssets.filter((asset) => asset.type === "IMAGE");
    setIsPreparingPdf(true);
    setPdfError(null);
    setPdfPreparingFile("");

    const sources = new Map(pdfImageSourcesRef.current);
    const queue = images.filter((asset) => !sources.has(asset.id));
    setPdfPreparation({ done: images.length - queue.length, total: images.length });
    let nextIndex = 0;

    const prepareNext = async (): Promise<void> => {
      const index = nextIndex++;
      if (index >= queue.length) return;

      const asset = queue[index];
      setPdfPreparingFile(asset.originalFileName || asset.id);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(
          `${immichConfig.baseUrl}/assets/${asset.id}/thumbnail?size=fullsize`,
          {
            headers: { "x-api-key": immichConfig.apiKey },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const disposition = response.headers.get("content-disposition") || "";
        const isHeic =
          asset.originalMimeType?.toLowerCase().includes("heic") ||
          asset.originalMimeType?.toLowerCase().includes("heif") ||
          /\.(heic|heif)$/i.test(asset.originalFileName);
        if (isHeic && /_preview\./i.test(disposition)) {
          throw new Error(
            "Immich only returned a preview for this HEIC image. Enable Fullsize thumbnails in Immich and regenerate this asset's thumbnails, then retry.",
          );
        }

        const imageBlob = await response.blob();
        if (!["image/jpeg", "image/jpg", "image/png"].includes(imageBlob.type.toLowerCase())) {
          throw new Error(
            `Immich returned unsupported PDF image format ${imageBlob.type || "unknown"}`,
          );
        }
        const source = URL.createObjectURL(imageBlob);
        sources.set(asset.id, source);
        pdfImageSourcesRef.current.set(asset.id, source);
      } catch (assetError) {
        const reason =
          assetError instanceof DOMException && assetError.name === "AbortError"
            ? "Download timed out after 2 minutes"
            : (assetError as Error).message;
        throw new Error(
          `Failed to prepare ${asset.originalFileName || asset.id}: ${reason}`,
        );
      } finally {
        window.clearTimeout(timeout);
        setPdfPreparation((progress) => ({ ...progress, done: progress.done + 1 }));
      }

      await prepareNext();
    };

    try {
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(4, queue.length) }, () => prepareNext()),
      );
      const failedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedResult) throw failedResult.reason;
      setMode("pdf");
    } catch (prepareError) {
      setPdfError((prepareError as Error).message);
    } finally {
      setPdfImageSources(new Map(pdfImageSourcesRef.current));
      setIsPreparingPdf(false);
    }
  };


  // Handle aspect ratio drag start
  const handleAspectDragStart = (
    assetId: string,
    edge: "left" | "right",
    aspectRatio: number,
    x: number,
    width: number,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setAspectDragState({
      assetId,
      edge,
      startX: event.clientX,
      originalAspectRatio: aspectRatio,
      originalX: x,
      originalWidth: width,
    });
  };

  // Reset all aspect ratio customizations
  const handleResetAllCustomizations = () => {
    setCustomAspectRatios(new Map());
  };

  // Drag & drop handlers for reordering
  const handleReorderDragStart = (
    assetId: string,
    index: number,
    event: React.DragEvent,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    setReorderDragState({ draggedAssetId: assetId, draggedIndex: index });
  };

  const handleReorderDragOver = (index: number, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
  };

  const handleReorderDragEnd = () => {
    setReorderDragState(null);
    setDropTargetIndex(null);
  };

  const handleReorderDrop = (targetIndex: number, event: React.DragEvent) => {
    event.preventDefault();

    if (!reorderDragState) return;

    const { draggedIndex } = reorderDragState;

    if (draggedIndex === targetIndex) {
      handleReorderDragEnd();
      return;
    }

    // Create new ordering based on current filtered assets
    const currentOrder = filteredAssets.map((asset) => asset.id);
    const newOrder = [...currentOrder];

    // Remove from old position
    const [removed] = newOrder.splice(draggedIndex, 1);
    // Insert at new position
    newOrder.splice(targetIndex, 0, removed);

    setCustomOrdering(newOrder);
    handleReorderDragEnd();
  };

  // Reset ordering to default
  const handleResetOrdering = () => {
    setCustomOrdering(null);
  };

  // Reset all description position customizations
  const handleResetDescriptionPositions = () => {
    setDescriptionPositions(new Map());
  };

  // Cycle description position
  const handleDescriptionClick = (assetId: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Find the asset to check if it has a description
    const asset = filteredAssets.find((a) => a.id === assetId);
    const hasDescription = !!asset?.exifInfo?.description;

    // Build the cycle based on whether there's a description
    const positions: Position[] = hasDescription
      ? ["bottom", "top", "left", "right"]
      : ["bottom", "top"];

    const currentPosition = descriptionPositions.get(assetId) || "bottom";
    const currentIndex = positions.indexOf(currentPosition);
    const nextPosition = positions[(currentIndex + 1) % positions.length];

    setDescriptionPositions((prev) => {
      const next = new Map(prev);
      if (nextPosition === "bottom") {
        // Reset to default
        next.delete(assetId);
      } else {
        next.set(assetId, nextPosition);
      }
      return next;
    });
  };

  // Filter assets based on user preferences (default order)
  const defaultFilteredAssets = useMemo(() => {
    return filterVideos
      ? assets.filter((asset) => asset.type === "IMAGE")
      : assets;
  }, [assets, filterVideos]);

  // Apply custom ordering to filtered assets
  const filteredAssets = useMemo(() => {
    if (!customOrdering) return defaultFilteredAssets;

    // Create a map for quick lookup
    const assetMap = new Map(
      defaultFilteredAssets.map((asset) => [asset.id, asset]),
    );
    // Reorder based on customOrdering, filtering out any IDs that don't exist
    const reordered = customOrdering
      .map((id) => assetMap.get(id))
      .filter((asset): asset is AssetResponseDto => asset !== undefined);

    // Add any assets that aren't in customOrdering at the end
    const orderedIds = new Set(customOrdering);
    const remaining = defaultFilteredAssets.filter(
      (asset) => !orderedIds.has(asset.id),
    );

    return [...reordered, ...remaining];
  }, [defaultFilteredAssets, customOrdering]);

  // Calculate content width for snapping
  const contentWidth = useMemo(() => {
    return validPageWidth - validMargin * 2;
  }, [validPageWidth, validMargin]);


// (Обновление) Calculate unified page layout - single source of truth!
  const pages = useMemo(() => {
    const adjustedAspectRatios = new Map<string, number>();

    filteredAssets.forEach((asset) => {
      // 1. Берем пользовательский аспект, если он менялся вручную, иначе вычисляем из ширины и высоты
      const baseRatio = customAspectRatios.get(asset.id) || getAssetAspectRatio(asset);

      const descPosition = descriptionPositions.get(asset.id) || "bottom";
      const hasDescription = showDescriptions && !!(asset.exifInfo?.description || (asset as any)?.description);

      // 2. Удваиваем ширину только если описание выводится сбоку
      if (hasDescription && (descPosition === "left" || descPosition === "right")) {
        adjustedAspectRatios.set(asset.id, baseRatio * 2);
      } else {
        adjustedAspectRatios.set(asset.id, baseRatio);
      }
    });
// Выше Обновлённая функция

    return calculatePageLayout(filteredAssets, {
      pageSize: "CUSTOM",
      orientation: "portrait",
      margin: validMargin,
      rowHeight: validRowHeight,
      spacing: validSpacing,
      customWidth: validPageWidth,
      customHeight: validPageHeight,
      combinePages,
      customAspectRatios: adjustedAspectRatios,
      pageAlignments,
    });
  }, [
    filteredAssets,
    validMargin,
    validRowHeight,
    validSpacing,
    validPageWidth,
    validPageHeight,
    combinePages,
    customAspectRatios,
    descriptionPositions,
    showDescriptions,
    pageAlignments,
  ]);

  // Handle aspect ratio drag
  useEffect(() => {
    if (!aspectDragState) return;

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - aspectDragState.startX;
      // Convert from 72 DPI screen to 300 DPI layout
      const deltaPixels = deltaX * (300 / 72);

      // Calculate new width based on edge being dragged
      const widthDelta =
        aspectDragState.edge === "right" ? deltaPixels : -deltaPixels;
      let newWidth = Math.max(50, aspectDragState.originalWidth + widthDelta);

      // Snap to full width when within threshold
      // Determine which page the image is on and snap to that page's right edge
      const snapThreshold = 50;
      const singlePageWidth = contentWidth + validMargin;

      // Calculate which page we're on (0-indexed)
      const pageIndex = Math.floor(
        aspectDragState.originalX / (singlePageWidth + validMargin),
      );

      // Calculate this page's start X position
      const pageStartX =
        pageIndex * (singlePageWidth + validMargin) + validMargin;

      // Calculate right edge relative to this page's start
      const rightEdge = aspectDragState.originalX - pageStartX + newWidth;

      if (Math.abs(rightEdge - contentWidth) <= snapThreshold) {
        newWidth = pageStartX + contentWidth - aspectDragState.originalX;
      }

      // Calculate new aspect ratio (width stays same height, so aspect ratio changes)
      const heightFromOriginal =
        aspectDragState.originalWidth / aspectDragState.originalAspectRatio;
      const newAspectRatio = newWidth / heightFromOriginal;

      setCustomAspectRatios((prev) => {
        const next = new Map(prev);
        next.set(aspectDragState.assetId, newAspectRatio);
        return next;
      });
    };

    const handleMouseUp = () => {
      setAspectDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [aspectDragState, contentWidth, margin]);

  // Determine pageLayout based on combinePages setting
  const pageLayout = combinePages ? "singlePage" : "twoPageLeft";

  // Calculate total logical pages for display purposes
  const totalLogicalPages = combinePages ? pages.length * 2 : pages.length;

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        <p className="mt-4 text-gray-600">Loading photos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto">
        <button
          onClick={onBack}
          className="mb-4 text-blue-600 hover:text-blue-800"
        >
          ← Back to albums
        </button>
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
          <button
            onClick={loadAlbumAssets}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm transition-colors shadow-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div className="mb-6 flex flex-col lg:flex-row flex-1 items-start lg:justify-between gap-4 lg:gap-8">
        <div className="w-full lg:w-auto">
          <button
            onClick={onBack}
            className="text-blue-600 hover:text-blue-800 mb-2"
          >
            ← Back to albums
          </button>
          <h2 className="text-2xl font-semibold">{album.albumName}</h2>
          <p className="text-gray-600 mt-1">
            {filteredAssets.length}{" "}
            {filteredAssets.length !== assets.length && `of ${assets.length}`}{" "}
            assets
          </p>

          {/* Generate PDF / Back to Edit button */}
          <div className="mt-4">
            {mode === "preview" ? (
              <button
                onClick={preparePdf}
                disabled={isPreparingPdf}
                className="w-full max-w-xl px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 font-medium transition-colors shadow-sm"
              >
                {isPreparingPdf
                  ? `Preparing originals (${pdfPreparation.done}/${pdfPreparation.total})...`
                  : "Generate PDF"}
              </button>
            ) : (
              <button
                onClick={() => setMode("preview")}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium transition-colors shadow-sm"
              >
                Back to Edit
              </button>
            )}
          </div>
          {isPreparingPdf && pdfPreparingFile && (
            <p className="mt-2 w-full max-w-xl text-xs leading-relaxed text-gray-600">
              <span className="font-medium">Current file: </span>
              <span className="[overflow-wrap:anywhere]">{pdfPreparingFile}</span>
            </p>
          )}
          {pdfError && (
            <div className="mt-3 max-w-xl rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{pdfError}</p>
              <button
                onClick={preparePdf}
                disabled={isPreparingPdf}
                className="mt-2 font-medium underline disabled:opacity-50"
              >
                Retry PDF preparation
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 w-full lg:w-auto">
          {/* 1. Page Setup */}
          <div className="p-2 bg-gray-50 rounded border border-gray-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-gray-700 sm:w-28">
                Page
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="pageWidth" className="text-gray-600 text-xs">
                    Width:
                  </label>
                  <input
                    type="number"
                    id="pageWidth"
                    value={pageWidth}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setPageWidth(value);
                      }
                    }}
                    min="1000"
                    max="10000"
                    className={`px-1 py-0.5 w-16 text-xs border rounded ${
                      isPageWidthValid
                        ? "border-gray-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                  <span className="text-xs text-gray-500">px</span>
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="pageHeight" className="text-gray-600 text-xs">
                    Height:
                  </label>
                  <input
                    type="number"
                    id="pageHeight"
                    value={pageHeight}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setPageHeight(value);
                      }
                    }}
                    min="1000"
                    max="10000"
                    className={`px-1 py-0.5 w-16 text-xs border rounded ${
                      isPageHeightValid
                        ? "border-gray-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                  <span className="text-xs text-gray-500">px</span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="combinePages"
                    checked={combinePages}
                    onChange={(e) => setCombinePages(e.target.checked)}
                    className="h-3 w-3"
                  />
                  <label
                    htmlFor="combinePages"
                    className="text-xs text-gray-700"
                  >
                    Combine Pages
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Layout */}
          <div className="p-2 bg-gray-50 rounded border border-gray-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-gray-700 sm:w-28">
                Layout
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="margin" className="text-gray-600 text-xs">
                    Margin:
                  </label>
                  <input
                    type="number"
                    id="margin"
                    value={margin}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setMargin(value);
                      }
                    }}
                    min="0"
                    max={pageWidth / 2}
                    step="10"
                    className={`px-1 py-0.5 w-14 text-xs border rounded ${
                      isMarginValid
                        ? "border-gray-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                  <span className="text-xs text-gray-500">px</span>
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="rowHeight" className="text-gray-600 text-xs">
                    Row Height:
                  </label>
                  <input
                    type="number"
                    id="rowHeight"
                    value={rowHeight}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setRowHeight(value);
                      }
                    }}
                    min="300"
                    max={pageHeight}
                    step="10"
                    className={`px-1 py-0.5 w-14 text-xs border rounded ${
                      isRowHeightValid
                        ? "border-gray-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                  <span className="text-xs text-gray-500">px</span>
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="spacing" className="text-gray-600 text-xs">
                    Spacing:
                  </label>
                  <input
                    type="number"
                    id="spacing"
                    value={spacing}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!isNaN(value)) {
                        setSpacing(value);
                      }
                    }}
                    min="0"
                    max="100"
                    className={`px-1 py-0.5 w-12 text-xs border rounded ${
                      isSpacingValid
                        ? "border-gray-300"
                        : "border-red-500 bg-red-50"
                    }`}
                  />
                  <span className="text-xs text-gray-500">px</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Presentation */}
          <div className="p-2 bg-gray-50 rounded border border-gray-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h3 className="text-xs font-semibold text-gray-700 sm:w-28">
                Presentation
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="filterVideos"
                    checked={filterVideos}
                    onChange={(e) => setFilterVideos(e.target.checked)}
                    className="h-3 w-3"
                  />
                  <label
                    htmlFor="filterVideos"
                    className="text-xs text-gray-700"
                  >
                    Exclude Videos
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="showDates"
                    checked={showDates}
                    onChange={(e) => setShowDates(e.target.checked)}
                    className="h-3 w-3"
                  />
                  <label htmlFor="showDates" className="text-xs text-gray-700">
                    Show Dates
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="showDescriptions"
                    checked={showDescriptions}
                    onChange={(e) => setShowDescriptions(e.target.checked)}
                    className="h-3 w-3"
                  />
                  <label
                    htmlFor="showDescriptions"
                    className="text-xs text-gray-700"
                  >
                    Show Descriptions
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    id="includeCover"
                    checked={includeCover}
                    onChange={(e) => setIncludeCover(e.target.checked)}
                    className="h-3 w-3"
                  />
                  <label
                    htmlFor="includeCover"
                    className="text-xs text-gray-700"
                  >
                    Cover Page
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <label htmlFor="fontSize" className="text-gray-600 text-xs">
                    Font Size:
                  </label>
                  <select
                    id="fontSize"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="px-1 py-0.5 text-xs border border-gray-300 rounded"
                  >
                    <option value="8">8 pt</option>
                    <option value="9">9 pt</option>
                    <option value="10">10 pt</option>
                    <option value="11">11 pt</option>
                    <option value="12">12 pt</option>
                    <option value="14">14 pt</option>
                    <option value="16">16 pt</option>
                    <option value="18">18 pt</option>
                    <option value="20">20 pt</option>
                    <option value="22">22 pt</option>
                    <option value="24">24 pt</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Customizations (only shown when there are any) */}
          {(customAspectRatios.size > 0 ||
            customOrdering !== null ||
            descriptionPositions.size > 0) && (
            <div className="p-2 bg-gray-50 rounded border border-gray-300">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <h3 className="text-xs font-semibold text-gray-700 sm:w-28">
                  Customizations
                </h3>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {customOrdering !== null && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Custom order
                      </span>
                      <button
                        onClick={handleResetOrdering}
                        className="text-xs px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                  {customAspectRatios.size > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        <span className="w-2 h-2 bg-blue-500 rounded-full" />
                        {customAspectRatios.size} aspect ratio
                      </span>
                      <button
                        onClick={handleResetAllCustomizations}
                        className="text-xs px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                  {descriptionPositions.size > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        <span className="w-2 h-2 bg-purple-500 rounded-full" />
                        {descriptionPositions.size} label position
                      </span>
                      <button
                        onClick={handleResetDescriptionPositions}
                        className="text-xs px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {mode === "pdf" ? (
        /* PDF Viewer */
        <div
          className="w-full"
          style={{ height: "calc(100vh - 200px)", minHeight: "400px" }}
        >
          <PDFViewer width="100%" height="100%" showToolbar={true}>
            <Document pageLayout={pageLayout}>
              {includeCover && pages.length > 0 && (
                <Page
                  key="cover-page"
                  size={{
                    width: toPoints(pages[0].width),
                    height: toPoints(pages[0].height),
                  }}
                  style={{
                    backgroundColor: "#FFFFFF",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: 40,
                  }}
                >
                  <View
                    style={{
                      width: "100%",
                      marginTop: 30,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      hyphenationCallback={(word) => [word]}
                      style={{
                        width: "100%",
                        fontSize: 24,
                        fontFamily: "RobotoCyrillic",
                        fontWeight: 500,
                        color: "#1F2937",
                        textAlign: "center",
                        letterSpacing: 0,
                        lineHeight: 1.2,
                        marginBottom: 10,
                      }}
                    >
                      {album.albumName}
                    </Text>
                    {!!albumDescription.trim() && (
                      <Text
                        hyphenationCallback={(word) => [word]}
                        style={{
                          width: "100%",
                          fontSize: 12,
                          fontFamily: "RobotoCyrillic",
                          fontWeight: 400,
                          color: "#4B5563",
                          textAlign: "center",
                          lineHeight: 1.35,
                          marginBottom: 8,
                        }}
                      >
                        {albumDescription}
                      </Text>
                    )}
                    <Text
                      style={{
                        fontSize: 14,
                        fontFamily: "RobotoCyrillic",
                        fontWeight: 400,
                        color: "#6B7280",
                        textAlign: "center",
                      }}
                    >
                      Фотокнига • {assets.length} фото
                    </Text>
                  </View>

                  {(album.albumThumbnailAssetId || assets[0]?.id) && (
                    <View
                      style={{
                        width: "80%",
                        height: "65%",
                        borderRadius: 4,
                        overflow: "hidden",
                        backgroundColor: "#F3F4F6",
                      }}
                    >
                      <Image
                        src={
                          pdfImageSources.get(
                            album.albumThumbnailAssetId || assets[0].id,
                          ) ||
                          `${immichConfig.baseUrl}/assets/${
                            album.albumThumbnailAssetId || assets[0].id
                          }/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`
                        }
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                        }}
                      />
                    </View>
                  )}

                  <View style={{ marginBottom: 20 }}>
                    <Text
                      style={{
                        fontSize: 10,
                        fontFamily: "RobotoLatin",
                        fontWeight: 400,
                        color: "#9CA3AF",
                        letterSpacing: 1,
                        textTransform: "uppercase",
                      }}
                    >
                      NEUROCAT & IMMICH PHOTOBOOK
                    </Text>
                  </View>
                </Page>
              )}
              {pages.map((pageData) => {
                // FIXME: pdfkit (internal of react-pdf) uses 72dpi internally and we downscale everything here;
                // instead we should produce a high-quality 300 dpi pdf

                // Convert page dimensions from 300 DPI to 72 DPI
                const pageWidth = toPoints(pageData.width);
                const pageHeight = toPoints(pageData.height);
                return (
                  <Page
                    key={pageData.pageNumber}
                    size={{
                      width: pageWidth,
                      height: pageHeight,
                    }}
                    style={staticStyles.page}
                  >
                    {/* Page break indicator for combined pages */}
                    {combinePages && (
                      <View
                        style={{
                          position: "absolute",
                          left: pageWidth / 2,
                          top: 0,
                          bottom: 0,
                          width: 1,
                          borderLeft: "1 dashed #D1D5DB",
                        }}
                      />
                    )}

                    {pageData.photos.map((photoBox) => {
                      const imageUrl =
                        pdfImageSources.get(photoBox.asset.id) ||
                        `${immichConfig.baseUrl}/assets/${photoBox.asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`;
                      const descPosition =
                        descriptionPositions.get(photoBox.asset.id) || "bottom";
                      const hasDescription =
                        showDescriptions &&
                        !!photoBox.asset.exifInfo?.description;
                      const isLeftRight =
                        hasDescription &&
                        (descPosition === "left" || descPosition === "right");

                      // When description is on left/right, photoBox.width is already doubled by the layout algorithm
                      // So we use it as-is and split it between image and description
                      const containerWidth = toPoints(photoBox.width);
                      const imageWidth = isLeftRight
                        ? toPoints(photoBox.width) / 2
                        : toPoints(photoBox.width);

                      // Use absolute positioning for everything (no flex for left/right)
                      const containerStyle = [
                        staticStyles.photoContainer,
                        {
                          left: toPoints(photoBox.x),
                          top: toPoints(photoBox.y),
                          width: containerWidth,
                          height: toPoints(photoBox.height),
                        },
                      ];

                      return (
                        <View key={photoBox.asset.id} style={containerStyle}>
                          {/* Description on left - absolutely positioned */}
                          {hasDescription && descPosition === "left" && (
                            <View
                              style={[
                                pdfStyles.descriptionSide,
                                {
                                  position: "absolute",
                                  left: 0,
                                  top: 0,
                                  width: imageWidth,
                                  height: toPoints(photoBox.height),
                                },
                              ]}
                            >
                              <Text
                                hyphenationCallback={(word) => [word]}
                                style={pdfStyles.text}
                              >
                                {photoBox.asset.exifInfo?.description}
                              </Text>
                            </View>
                          )}

                          {/* Image - absolutely positioned */}
                          <Image
                            src={imageUrl}
                            style={
                              isLeftRight
                                ? {
                                    position: "absolute",
                                    left:
                                      descPosition === "left" ? imageWidth : 0,
                                    top: 0,
                                    width: imageWidth,
                                    height: toPoints(photoBox.height),
                                    objectFit: "cover",
                                  }
                                : staticStyles.photo
                            }
                          />

                          {/* Description on right - absolutely positioned */}
                          {hasDescription && descPosition === "right" && (
                            <View
                              style={[
                                pdfStyles.descriptionSide,
                                {
                                  position: "absolute",
                                  right: 0,
                                  top: 0,
                                  width: imageWidth,
                                  height: toPoints(photoBox.height),
                                },
                              ]}
                            >
                              <Text
                                hyphenationCallback={(word) => [word]}
                                style={pdfStyles.text}
                              >
                                {photoBox.asset.exifInfo?.description}
                              </Text>
                            </View>
                          )}

                          {/* Date - absolutely positioned */}
                          {showDates && photoBox.asset.fileCreatedAt && (
                            <View
                              style={(() => {
                                switch (descPosition) {
                                  case "bottom":
                                    return {
                                      ...pdfStyles.dateOverlay,
                                      position: "absolute",
                                      top: 8,
                                      right: 8,
                                    };
                                  case "top":
                                    return {
                                      ...pdfStyles.dateOverlay,
                                      position: "absolute",
                                      bottom: 8,
                                      right: 8,
                                    };
                                  case "left":
                                    return {
                                      position: "absolute",
                                      top: 16,
                                      left: 8,
                                    };
                                  case "right":
                                    return {
                                      position: "absolute",
                                      top: 16,
                                      left: imageWidth + 8,
                                    };
                                  default:
                                    return {
                                      ...pdfStyles.dateOverlay,
                                      position: "absolute",
                                      top: 8,
                                      right: 8,
                                    };
                                }
                              })()}
                            >
                              <Text style={pdfStyles.text}>
                                {new Date(
                                  photoBox.asset.fileCreatedAt,
                                ).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </Text>
                            </View>
                          )}

                          {/* Description for top/bottom positions */}
                          {hasDescription &&
                            (descPosition === "top" ||
                              descPosition === "bottom") && (
                              <Text
                                hyphenationCallback={(word) => [word]}
                                style={{
                                  ...pdfStyles.descriptionOverlay,
                                  position: "absolute",
                                  ...(descPosition === "top"
                                    ? { top: 0 }
                                    : { bottom: 0 }),
                                  left: 0,
                                  right: 0,
                                }}
                              >
                                {photoBox.asset.exifInfo?.description}
                              </Text>
                            )}
                        </View>
                      );
                    })}
                  </Page>
                );
              })}
            </Document>
          </PDFViewer>
        </div>
      ) : (
        /* Live Preview */
        <div className="space-y-8 pb-8 overflow-x-auto px-4 sm:px-0">
          {includeCover && pages.length > 0 && (
            <div className="relative">
              <div
                className="mb-2 flex justify-center"
                style={{
                  width: `${toPoints(pages[0].width)}px`,
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
              >
                <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                  Cover Page
                </span>
              </div>
              <div
                className="relative bg-white shadow-lg mx-auto border border-gray-200 flex flex-col items-center justify-between"
                style={{
                  width: `${toPoints(pages[0].width)}px`,
                  height: `${toPoints(pages[0].height)}px`,
                  padding: 40,
                }}
              >
                <div className="mt-[30px] w-full flex flex-col items-center text-center">
                  <h1 className="max-w-full text-2xl leading-tight font-medium text-gray-800">
                    {album.albumName}
                  </h1>
                  {!!albumDescription.trim() && (
                    <p className="mt-2 max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-600">
                      {albumDescription}
                    </p>
                  )}
                  <p className="mt-2 text-sm text-gray-500">
                    Фотокнига • {assets.length} фото
                  </p>
                </div>

                {(album.albumThumbnailAssetId || assets[0]?.id) && (
                  <div className="w-4/5 h-[65%] overflow-hidden rounded bg-gray-100">
                    <img
                      src={`${immichConfig.baseUrl}/assets/${
                        album.albumThumbnailAssetId || assets[0].id
                      }/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`}
                      alt={album.albumName}
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

                <p className="mb-5 text-[10px] uppercase tracking-[1px] text-gray-400">
                  NEUROCAT & IMMICH PHOTOBOOK
                </p>
              </div>
            </div>
          )}
          {pages.map((page) => {
            // Scale down to match PDF dimensions (72 DPI from 300 DPI)
            const displayWidth = toPoints(page.width);
            const displayHeight = toPoints(page.height);

            return (
              <div key={page.pageNumber} className="relative">
                {/* Page number and alignment controls */}
                {combinePages ? (
                  /* Combined pages mode - show controls above each logical page */
                  <div
                    className="mb-2 flex"
                    style={{
                      width: `${displayWidth}px`,
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  >
                    {/* Left page controls */}
                    <div
                      className="flex items-center justify-center gap-2"
                      style={{ width: `${displayWidth / 2}px` }}
                    >
                      <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                        Page {page.pageNumber * 2 - 1} of {totalLogicalPages}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            const leftPageNum = page.pageNumber * 2 - 1;
                            const newAlignments = new Map(pageAlignments);
                            newAlignments.set(leftPageNum, "left");
                            setPageAlignments(newAlignments);
                          }}
                          className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                            (pageAlignments.get(page.pageNumber * 2 - 1) ||
                              getDefaultPageAlignment(page.pageNumber * 2 - 1)) ===
                            "left"
                              ? "bg-blue-500 text-white border-blue-500"
                              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                          }`}
                          title="Align to left"
                        >
                          <Icon path={mdiFormatAlignLeft} size={0.6} />
                        </button>
                        <button
                          onClick={() => {
                            const leftPageNum = page.pageNumber * 2 - 1;
                            const newAlignments = new Map(pageAlignments);
                            newAlignments.set(leftPageNum, "center");
                            setPageAlignments(newAlignments);
                          }}
                          className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                            (pageAlignments.get(page.pageNumber * 2 - 1) ||
                              getDefaultPageAlignment(page.pageNumber * 2 - 1)) ===
                            "center"
                              ? "bg-blue-500 text-white border-blue-500"
                              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                          }`}
                          title="Align to center"
                        >
                          <Icon path={mdiFormatAlignCenter} size={0.6} />
                        </button>
                        <button
                          onClick={() => {
                            const leftPageNum = page.pageNumber * 2 - 1;
                            const newAlignments = new Map(pageAlignments);
                            newAlignments.set(leftPageNum, "right");
                            setPageAlignments(newAlignments);
                          }}
                          className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                            (pageAlignments.get(page.pageNumber * 2 - 1) ||
                              getDefaultPageAlignment(page.pageNumber * 2 - 1)) ===
                            "right"
                              ? "bg-blue-500 text-white border-blue-500"
                              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                          }`}
                          title="Align to right"
                        >
                          <Icon path={mdiFormatAlignRight} size={0.6} />
                        </button>
                      </div>
                    </div>

                    {/* Right page controls (only if it exists) */}
                    {page.pageNumber * 2 <= totalLogicalPages && (
                      <div
                        className="flex items-center justify-center gap-2"
                        style={{ width: `${displayWidth / 2}px` }}
                      >
                        <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                          Page {page.pageNumber * 2} of {totalLogicalPages}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              const rightPageNum = page.pageNumber * 2;
                              const newAlignments = new Map(pageAlignments);
                              newAlignments.set(rightPageNum, "left");
                              setPageAlignments(newAlignments);
                            }}
                            className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                              (pageAlignments.get(page.pageNumber * 2) ||
                                getDefaultPageAlignment(page.pageNumber * 2)) ===
                              "left"
                                ? "bg-blue-500 text-white border-blue-500"
                                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                            }`}
                            title="Align to left"
                          >
                            <Icon path={mdiFormatAlignLeft} size={0.6} />
                          </button>
                          <button
                            onClick={() => {
                              const rightPageNum = page.pageNumber * 2;
                              const newAlignments = new Map(pageAlignments);
                              newAlignments.set(rightPageNum, "center");
                              setPageAlignments(newAlignments);
                            }}
                            className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                              (pageAlignments.get(page.pageNumber * 2) ||
                                getDefaultPageAlignment(page.pageNumber * 2)) ===
                              "center"
                                ? "bg-blue-500 text-white border-blue-500"
                                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                            }`}
                            title="Align to center"
                          >
                            <Icon path={mdiFormatAlignCenter} size={0.6} />
                          </button>
                          <button
                            onClick={() => {
                              const rightPageNum = page.pageNumber * 2;
                              const newAlignments = new Map(pageAlignments);
                              newAlignments.set(rightPageNum, "right");
                              setPageAlignments(newAlignments);
                            }}
                            className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                              (pageAlignments.get(page.pageNumber * 2) ||
                                getDefaultPageAlignment(page.pageNumber * 2)) ===
                              "right"
                                ? "bg-blue-500 text-white border-blue-500"
                                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                            }`}
                            title="Align to right"
                          >
                            <Icon path={mdiFormatAlignRight} size={0.6} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Single page mode - center everything */
                  <div className="text-center mb-2 flex items-center justify-center gap-2">
                    <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                      Page {page.pageNumber} of {totalLogicalPages}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          const newAlignments = new Map(pageAlignments);
                          newAlignments.set(page.pageNumber, "left");
                          setPageAlignments(newAlignments);
                        }}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                          (pageAlignments.get(page.pageNumber) ||
                            getDefaultPageAlignment(page.pageNumber)) === "left"
                            ? "bg-blue-500 text-white border-blue-500"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                        title="Align to left"
                      >
                        <Icon path={mdiFormatAlignLeft} size={0.6} />
                      </button>
                      <button
                        onClick={() => {
                          const newAlignments = new Map(pageAlignments);
                          newAlignments.set(page.pageNumber, "center");
                          setPageAlignments(newAlignments);
                        }}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                          (pageAlignments.get(page.pageNumber) ||
                            getDefaultPageAlignment(page.pageNumber)) === "center"
                            ? "bg-blue-500 text-white border-blue-500"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                        title="Align to center"
                      >
                        <Icon path={mdiFormatAlignCenter} size={0.6} />
                      </button>
                      <button
                        onClick={() => {
                          const newAlignments = new Map(pageAlignments);
                          newAlignments.set(page.pageNumber, "right");
                          setPageAlignments(newAlignments);
                        }}
                        className={`px-2 py-1 text-xs border rounded transition-colors flex items-center ${
                          (pageAlignments.get(page.pageNumber) ||
                            getDefaultPageAlignment(page.pageNumber)) === "right"
                            ? "bg-blue-500 text-white border-blue-500"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                        title="Align to right"
                      >
                        <Icon path={mdiFormatAlignRight} size={0.6} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Page container */}
                <div
                  className="relative bg-white shadow-lg mx-auto border border-gray-200"
                  style={{
                    width: `${displayWidth}px`,
                    height: `${displayHeight}px`,
                  }}
                >
                  {/* Page break indicator for combined pages */}
                  {combinePages && (
                    <div
                      className="absolute top-0 bottom-0 border-l border-dashed border-gray-300 z-10 pointer-events-none"
                      style={{ left: `${displayWidth / 2}px` }}
                    />
                  )}

                  {/* Photos */}
                  {page.photos.map((photoBox) => {
                    const imageUrl = `${immichConfig.baseUrl}/assets/${photoBox.asset.id}/thumbnail?size=preview&apiKey=${immichConfig.apiKey}`;
                    const isDragging =
                      aspectDragState?.assetId === photoBox.asset.id;

                    // Old version of the Calculate current aspect ratio
//                    const naturalWidth =
//                      photoBox.asset.exifInfo?.exifImageWidth || 1;
//                    const naturalHeight =
//                      photoBox.asset.exifInfo?.exifImageHeight || 1;
//                    let currentAspectRatio = naturalWidth / naturalHeight;
//                    if (photoBox.asset.exifInfo?.orientation == "6") {
//                      currentAspectRatio = naturalHeight / naturalWidth;
//                    }
                    // New version of the Calculate current aspect ratio
                    const currentAspectRatio = getAssetAspectRatio(photoBox.asset);

                    // Use custom aspect ratio if set
                    const aspectRatio =
                      customAspectRatios.get(photoBox.asset.id) ||
                      currentAspectRatio;
                    const hasAspectRatioCustomization = customAspectRatios.has(
                      photoBox.asset.id,
                    );
                    const hasDescriptionPositionCustomization =
                      descriptionPositions.has(photoBox.asset.id);
                    const isCustomized =
                      hasAspectRatioCustomization ||
                      hasDescriptionPositionCustomization;

                    // Find global index in filtered assets for drag & drop
                    const globalIndex = filteredAssets.findIndex(
                      (a) => a.id === photoBox.asset.id,
                    );
                    const isBeingDragged =
                      reorderDragState?.draggedAssetId === photoBox.asset.id;
                    const isDropTarget = dropTargetIndex === globalIndex;

                    // Check if this asset has been reordered (compare to default filtered order)
                    const defaultIndex = defaultFilteredAssets.findIndex(
                      (a) => a.id === photoBox.asset.id,
                    );
                    const isReordered =
                      customOrdering !== null && globalIndex !== defaultIndex;

                    const descPosition =
                      descriptionPositions.get(photoBox.asset.id) || "bottom";
                    const hasDescription =
                      showDescriptions &&
                      !!photoBox.asset.exifInfo?.description;
                    const isLeftRight =
                      hasDescription &&
                      (descPosition === "left" || descPosition === "right");

                    // When description is on left/right, photoBox.width is already doubled by the layout algorithm
                    // So we use it as-is and split it between image and description
                    const containerWidth = toPoints(photoBox.width);
                    const imageWidth = isLeftRight
                      ? toPoints(photoBox.width) / 2
                      : toPoints(photoBox.width);

                    return (
                      <div
                        key={photoBox.asset.id}
                        className={`absolute overflow-hidden group cursor-move ${isBeingDragged ? "opacity-50" : ""} ${isLeftRight ? "flex" : ""}`}
                        style={{
                          left: `${toPoints(photoBox.x)}px`,
                          top: `${toPoints(photoBox.y)}px`,
                          width: `${containerWidth}px`,
                          height: `${toPoints(photoBox.height)}px`,
                          flexDirection: "row",
                        }}
                        draggable
                        onDragStart={(e) =>
                          handleReorderDragStart(
                            photoBox.asset.id,
                            globalIndex,
                            e,
                          )
                        }
                        onDragOver={(e) =>
                          handleReorderDragOver(globalIndex, e)
                        }
                        onDragEnd={handleReorderDragEnd}
                        onDrop={(e) => handleReorderDrop(globalIndex, e)}
                      >
                        {/* Drop indicator - shown on left edge when hovering during drag */}
                        {isDropTarget && reorderDragState && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500 shadow-lg z-10" />
                        )}

                        {/* Description on left (when position is 'left') */}
                        {hasDescription && descPosition === "left" && (
                          <div
                            className="text-black cursor-pointer bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
                            style={{
                              width: `${imageWidth}px`,
                              flexShrink: 0,
                              ...webStyles.descriptionSide,
                            }}
                            onClick={(e) =>
                              handleDescriptionClick(photoBox.asset.id, e)
                            }
                            title="Click to change position"
                          >
                            {photoBox.asset.exifInfo?.description}
                          </div>
                        )}

                        <img
                          src={imageUrl}
                          alt={photoBox.asset.originalFileName}
                          className="object-cover w-full h-full"
                          style={
                            isLeftRight
                              ? { width: `${imageWidth}px`, flexShrink: 0 }
                              : undefined
                          }
                          loading="lazy"
                        />
                        {showDates &&
                          photoBox.asset.fileCreatedAt &&
                          (() => {
                            const getDateConfig = () => {
                              switch (descPosition) {
                                case "bottom":
                                  return {
                                    className:
                                      "absolute top-2 right-2 bg-white/70 text-black backdrop-blur-sm cursor-pointer hover:bg-white/80 transition-colors",
                                    style: webStyles.date,
                                  };
                                case "top":
                                  return {
                                    className:
                                      "absolute bottom-2 right-2 bg-white/70 text-black backdrop-blur-sm cursor-pointer hover:bg-white/80 transition-colors",
                                    style: webStyles.date,
                                  };
                                case "left":
                                  return {
                                    className:
                                      "absolute top-4 left-2 text-black cursor-pointer",
                                    style: webStyles.date,
                                  };
                                case "right":
                                  return {
                                    className:
                                      "absolute top-4 text-black cursor-pointer",
                                    style: {
                                      ...webStyles.date,
                                      left: `${imageWidth + 8}px`,
                                    },
                                  };
                                default:
                                  return {
                                    className:
                                      "absolute top-2 right-2 bg-white/70 text-black backdrop-blur-sm cursor-pointer hover:bg-white/80 transition-colors",
                                    style: webStyles.date,
                                  };
                              }
                            };
                            const config = getDateConfig();
                            return (
                              <div
                                className={config.className}
                                style={config.style}
                                onClick={(e) =>
                                  handleDescriptionClick(photoBox.asset.id, e)
                                }
                                title="Click to change position"
                              >
                                {new Date(
                                  photoBox.asset.fileCreatedAt,
                                ).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </div>
                            );
                          })()}
                        {showDescriptions &&
                          photoBox.asset.exifInfo?.description &&
                          (() => {
                            const descPosition =
                              descriptionPositions.get(photoBox.asset.id) ||
                              "bottom";
                            const description =
                              photoBox.asset.exifInfo?.description;

                            if (
                              descPosition === "left" ||
                              descPosition === "right"
                            ) {
                              // For left/right: description is next to image, not overlaid
                              return null;
                            }

                            const getDescriptionConfig = () => {
                              switch (descPosition) {
                                case "top":
                                  return {
                                    className:
                                      "absolute top-0 left-0 right-0 bg-white/70 text-black cursor-pointer hover:bg-white/80 transition-colors z-10",
                                    style: webStyles.description,
                                  };
                                case "bottom":
                                default:
                                  return {
                                    className:
                                      "absolute bottom-0 left-0 right-0 bg-white/70 text-black cursor-pointer hover:bg-white/80 transition-colors z-10",
                                    style: webStyles.description,
                                  };
                              }
                            };

                            const config = getDescriptionConfig();

                            return (
                              <div
                                className={config.className}
                                style={config.style}
                                onClick={(e) =>
                                  handleDescriptionClick(photoBox.asset.id, e)
                                }
                                title="Click to change position"
                              >
                                {description}
                              </div>
                            );
                          })()}

                        {/* Description on right (when position is 'right') */}
                        {hasDescription && descPosition === "right" && (
                          <div
                            className="text-black cursor-pointer bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
                            style={{
                              width: `${imageWidth}px`,
                              flexShrink: 0,
                              ...webStyles.descriptionSide,
                            }}
                            onClick={(e) =>
                              handleDescriptionClick(photoBox.asset.id, e)
                            }
                            title="Click to change position"
                          >
                            {photoBox.asset.exifInfo?.description}
                          </div>
                        )}

                        {/* Customization indicators */}
                        {hasAspectRatioCustomization && (
                          <div
                            className="absolute top-2 left-2 w-2 h-2 bg-blue-500 rounded-full shadow-lg"
                            title="Aspect ratio customized"
                          />
                        )}
                        {hasDescriptionPositionCustomization && (
                          <div
                            className="absolute top-2 left-5 w-2 h-2 bg-purple-500 rounded-full shadow-lg"
                            title="Label position customized"
                          />
                        )}
                        {isReordered && (
                          <div
                            className="absolute top-2 left-8 w-2 h-2 bg-green-500 rounded-full shadow-lg"
                            title="Image reordered"
                          />
                        )}

                        {/* Reset button - shown on hover for customized images */}
                        {(isCustomized || isReordered) && (
                          <div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded shadow-lg text-xs font-medium"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Reset aspect ratio
                              if (hasAspectRatioCustomization) {
                                setCustomAspectRatios((prev) => {
                                  const next = new Map(prev);
                                  next.delete(photoBox.asset.id);
                                  return next;
                                });
                              }
                              // Reset description position
                              if (hasDescriptionPositionCustomization) {
                                setDescriptionPositions((prev) => {
                                  const next = new Map(prev);
                                  next.delete(photoBox.asset.id);
                                  return next;
                                });
                              }
                              // Reset custom ordering by rebuilding the array without this asset
                              // This moves the asset back to its default position
                              if (isReordered && customOrdering) {
                                const assetId = photoBox.asset.id;
                                const defaultIndex = defaultFilteredAssets.findIndex(
                                  (a) => a.id === assetId,
                                );

                                // Remove asset from custom ordering
                                const newOrdering = customOrdering.filter(
                                  (id) => id !== assetId,
                                );

                                // Insert it back at its default position
                                newOrdering.splice(defaultIndex, 0, assetId);

                                setCustomOrdering(newOrdering);
                              }
                            }}
                            title="Reset all customizations"
                          >
                            Reset
                          </div>
                        )}

                        {/* Left drag handle */}
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize transition-colors ${
                            isDragging && aspectDragState.edge === "left"
                              ? "bg-blue-500"
                              : "bg-transparent group-hover:bg-blue-400/50"
                          }`}
                          onMouseDown={(e) =>
                            handleAspectDragStart(
                              photoBox.asset.id,
                              "left",
                              aspectRatio,
                              photoBox.x,
                              photoBox.width,
                              e,
                            )
                          }
                        />

                        {/* Right drag handle */}
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize transition-colors ${
                            isDragging && aspectDragState.edge === "right"
                              ? "bg-blue-500"
                              : "bg-transparent group-hover:bg-blue-400/50"
                          }`}
                          onMouseDown={(e) =>
                            handleAspectDragStart(
                              photoBox.asset.id,
                              "right",
                              aspectRatio,
                              photoBox.x,
                              photoBox.width,
                              e,
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PhotoGrid;
