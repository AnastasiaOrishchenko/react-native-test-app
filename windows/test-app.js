//@ts-check
const path = require("path");
const fs = require("fs");
const chalk = require("chalk");

const windowsDir = "windows";
const nodeModulesDir = "node_modules";
const bundleDir = "Bundle";
const generatedDir = ".generated";
const closestNodeModules = findClosestPathTo(nodeModulesDir);
const reactNativeModulePath = findClosestPathTo(
  path.join(nodeModulesDir, "react-native-windows")
);
const testAppNodeModulePath = findClosestPathTo(
  path.join(nodeModulesDir, "react-native-test-app")
);
const destPath = path.resolve("");

function findClosestPathTo(fileOrDirName) {
  let basePath = path.resolve("");
  const rootDirectory = basePath.split(path.sep)[0] + path.sep;

  while (basePath !== rootDirectory) {
    const candidatePath = path.join(basePath, fileOrDirName);
    if (fs.existsSync(candidatePath)) {
      return path.relative("", candidatePath);
    }
    //Get parent folder
    basePath = path.dirname(basePath);
  }

  return null;
}

function walk(current) {
  if (!fs.lstatSync(current).isDirectory()) {
    return [current];
  }

  const files = fs
    .readdirSync(current)
    .map((child) => walk(path.join(current, child)));
  return [current, ...files.flat()];
}

/**
 * Get a source file and replace parts of its contents.
 * @param srcPath Path to the source file.
 * @param replacements e.g. {'TextToBeReplaced': 'Replacement'}
 * @return The contents of the file with the replacements applied.
 */
function resolveContents(srcPath, replacements) {
  const content = fs.readFileSync(srcPath, "utf8");

  return Object.keys(replacements).reduce((content, regex) => {
    return content.replace(new RegExp(regex, "g"), replacements[regex]);
  }, content);
}

//Binary files in React Native Test App Windows project
const binaryExtensions = [".png", ".pfx"];

/**
 * Copy a file to given destination, replacing parts of its contents.
 * @param srcPath Path to a file to be copied.
 * @param destPath Destination path.
 * @param replacements: e.g. {'TextToBeReplaced': 'Replacement'}
 */
function copyAndReplace(
  srcPath,
  destPath,
  relativeDestPath,
  replacements = {}
) {
  const fullDestPath = path.join(destPath, relativeDestPath);
  if (fs.lstatSync(srcPath).isDirectory()) {
    if (!fs.existsSync(fullDestPath)) {
      fs.mkdirSync(fullDestPath);
    }
    return;
  }

  const extension = path.extname(srcPath);
  if (binaryExtensions.indexOf(extension) !== -1) {
    // Binary file
    fs.copyFile(srcPath, fullDestPath, (err) => {
      if (err) {
        throw err;
      }
    });
  } else {
    // Text file
    const srcPermissions = fs.statSync(srcPath).mode;
    const content = resolveContents(srcPath, replacements);
    fs.writeFile(
      fullDestPath,
      content,
      {
        encoding: "utf8",
        mode: srcPermissions,
      },
      (err) => {
        if (err) {
          throw err;
        }
      }
    );
  }
}

function copyAndReplaceAll(
  srcPath,
  destPath,
  relativeDestDir,
  replacements = {}
) {
  return Promise.all(
    walk(srcPath).map((absoluteSrcFilePath) => {
      const filename = path.relative(srcPath, absoluteSrcFilePath);
      const relativeDestPath = path.join(relativeDestDir, filename);
      return copyAndReplace(
        absoluteSrcFilePath,
        destPath,
        relativeDestPath,
        replacements
      );
    })
  );
}

function copyProjectTemplateAndReplace(
  destPath,
  nodeModulesPath,
  reactNativeModulePath,
  testAppNodeModulePath
) {
  if (!destPath) {
    throw new Error("Need a path to copy to");
  }

  if (!reactNativeModulePath) {
    throw new Error("react-native-windows node module is not installed");
  }

  if (!testAppNodeModulePath) {
    throw new Error("react-native-test-app node module is not installed");
  }

  const srcRootPath = path.join(testAppNodeModulePath, windowsDir);
  const projDir = "ReactTestApp";
  const projectFilesDestPath = path.join(
    nodeModulesPath,
    generatedDir,
    windowsDir,
    projDir
  );

  fs.mkdirSync(path.join(projectFilesDestPath, bundleDir), { recursive: true });
  fs.mkdirSync(path.join(destPath, windowsDir), { recursive: true });

  const manifestFilePath = findClosestPathTo("app.json");

  //Read path to resources from manifest and copy them
  fs.readFile(manifestFilePath, (error, content) => {
    let resourcesPaths = JSON.parse(content.toString()).resources;
    resourcesPaths =
      (resourcesPaths && resourcesPaths.windows) || resourcesPaths;
    if (!Array.isArray(resourcesPaths)) {
      return;
    }
    for (const resource of resourcesPaths) {
      const resourceSrcPath = path.relative(
        path.dirname(manifestFilePath),
        resource
      );
      if (fs.existsSync(resourceSrcPath)) {
        copyAndReplaceAll(
          resourceSrcPath,
          projectFilesDestPath,
          path.join(bundleDir, path.basename(resource))
        );
      } else {
        console.log(
          chalk.yellow(`warning: resource with path ${resource} was not found`)
        );
      }
    }
  });

  const projectFilesReplacements = {
    "\\$\\(ManifestRootPath\\)": path.relative(
      path.join(projectFilesDestPath),
      path.dirname(manifestFilePath)
    ),
    "\\$\\(ReactNativeModulePath\\)": path.relative(
      projectFilesDestPath,
      reactNativeModulePath
    ),
    "\\$\\(SourceFilesPath\\)": path.relative(
      projectFilesDestPath,
      path.join(srcRootPath, projDir)
    ),
  };

  const projectFilesMappings = [
    "ReactTestApp.vcxproj",
    "PropertySheet.props",
    "Package.appxmanifest",
    "ReactTestApp.vcxproj.filters",
    "ReactTestApp_TemporaryKey.pfx",
    "packages.config",
  ].map((file) => ({
    from: path.join(srcRootPath, projDir, file),
    to: path.join(projectFilesDestPath, file),
  }));

  for (const mapping of projectFilesMappings) {
    copyAndReplace(
      mapping.from,
      destPath,
      mapping.to,
      projectFilesReplacements
    );
  }

  const solutionFileDestPath = path.join(destPath, windowsDir);
  const solutionFileReplacements = {
    "\\$\\(ReactNativeModulePath\\)": path.relative(
      solutionFileDestPath,
      reactNativeModulePath
    ),
    "\\$\\(ReactTestAppProjectPath\\)": path.relative(
      solutionFileDestPath,
      projectFilesDestPath
    ),
  };

  copyAndReplace(
    path.join(srcRootPath, "ReactTestApp.sln"),
    destPath,
    path.join(windowsDir, "ReactTestApp.sln"),
    solutionFileReplacements
  );
}

copyProjectTemplateAndReplace(
  destPath,
  closestNodeModules,
  reactNativeModulePath,
  testAppNodeModulePath
);
