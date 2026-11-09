export function getFileExtension(fileName: string, mimeType: string): string {
  if (fileName && fileName.includes('.')) {
    return fileName.split('.').pop()!.toLowerCase();
  }
  return (mimeType.split('/').pop() || '').toLowerCase();
}

export function getColorFromExtension(extension: string): 'green' | 'orange' | 'red' | 'default' {
  switch (extension) {
    case 'apk':
    case 'xls':
    case 'xlsx':
    case 'ods':
      return 'green';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'bz2':
    case 'liz':
    case 'lz4':
    case 'lz5':
    case 'xz':
    case 'zst':
    case 'wim':
    case 'ppt':
    case 'pptx':
    case 'odp':
      return 'orange';
    case 'pdf':
    case 'xps':
      return 'red';
    default:
      return 'default';
  }
}
