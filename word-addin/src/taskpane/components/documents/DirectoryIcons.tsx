import React, { type ImgHTMLAttributes } from "react";
import { File } from "lucide-react";
import excelIcon from "../../../assets/icons/file-types/excel.svg";
import pdfIcon from "../../../assets/icons/file-types/pdf.svg";
import pptIcon from "../../../assets/icons/file-types/ppt.svg";
import wordIcon from "../../../assets/icons/file-types/word.svg";
import folderClosedIcon from "../../../assets/icons/app-sidebar/folder-closed.svg";
import folderOpenIcon from "../../../assets/icons/app-sidebar/folder-open.svg";
import projectClosedIcon from "../../../assets/icons/app-sidebar/project-closed.svg";
import projectOpenIcon from "../../../assets/icons/app-sidebar/project-opened.svg";

type DirectoryIconProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "src"
>;

function iconKind(
  value: string | null | undefined,
): "pdf" | "word" | "excel" | "ppt" | "other" {
  const raw = (value ?? "").toLowerCase().trim();
  const extension = raw.includes(".") ? (raw.split(".").pop() ?? "") : raw;
  if (extension === "pdf") return "pdf";
  if (extension === "doc" || extension === "docx") return "word";
  if (["xls", "xlsx", "xlsm"].includes(extension)) return "excel";
  if (extension === "ppt" || extension === "pptx") return "ppt";
  return "other";
}

export function FileTypeIcon({
  fileType,
  className = "h-3.5 w-3.5",
}: {
  fileType: string | null | undefined;
  className?: string;
}): React.ReactElement {
  const source = {
    pdf: pdfIcon,
    word: wordIcon,
    excel: excelIcon,
    ppt: pptIcon,
    other: null,
  }[iconKind(fileType)];

  return source ? (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${className} shrink-0 object-contain`}
    />
  ) : (
    <File className={`${className} shrink-0 text-gray-500`} />
  );
}

function DirectorySvgIcon({
  source,
  className,
  ...props
}: DirectoryIconProps & { source: string }): React.ReactElement {
  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${className ?? ""} object-contain`}
      {...props}
    />
  );
}

export function SubfolderSvgIcon({
  open = false,
  ...props
}: DirectoryIconProps & { open?: boolean }): React.ReactElement {
  return (
    <DirectorySvgIcon
      source={open ? folderOpenIcon : folderClosedIcon}
      {...props}
    />
  );
}

export function ProjectSvgIcon({
  open = false,
  ...props
}: DirectoryIconProps & { open?: boolean }): React.ReactElement {
  return (
    <DirectorySvgIcon
      source={open ? projectOpenIcon : projectClosedIcon}
      {...props}
    />
  );
}
