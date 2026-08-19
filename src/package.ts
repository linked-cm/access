import { linkedPackage } from '@_linked/core/utils/Package';

export const {
  linkedShape,
  linkedUtil,
  linkedOntology,
  registerPackageExport,
  packageExports,
  packageName,
  getPackageShape,
} = linkedPackage('@_linked/access', {
  baseUri: 'https://id.create.now/access/',
});
