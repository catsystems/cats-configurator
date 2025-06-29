export function getFilename(filePath) {
  // Use a regex to split by either / or \ (to handle both Unix and Windows paths)
  // Then pop the last element
  const parts = filePath.split(/[\\/]/);
  const filename = parts.pop();
  
  // Handle cases where the path might end with a slash, resulting in an empty string
  if (filename === '' && parts.length > 0) {
      return parts.pop(); // Get the name of the directory itself
  }

  return filename;
}
