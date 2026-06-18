export const getFeedCategoryOpenState = ({
  categoryOpenStateData,
  folderName,
  isCategory,
}: {
  categoryOpenStateData: Record<string, boolean>
  folderName: string | null | undefined
  isCategory: boolean
}) => {
  if (!isCategory) return true
  if (folderName && typeof categoryOpenStateData[folderName] === "boolean") {
    return categoryOpenStateData[folderName]
  }
  return true
}
