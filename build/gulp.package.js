const exec = require('child_process').exec
const path = require('path')
const fse = require('fs-extra')
const gulp = require('gulp')
const glob = require('glob')
const mkdirp = require('mkdirp')
const fs = require('fs')
const archiver = require('archiver')

const promisify = require('util').promisify
const execAsync = promisify(exec)

const getTargetOSNodeVersion = () => {
  if (process.argv.find(x => x.toLowerCase() === '--win32')) {
    return 'node12-win32-x64'
  } else if (process.argv.find(x => x.toLowerCase() === '--linux')) {
    return 'node12-linux-x64'
  } else {
    return 'node12-macos-x64'
  }
}

const getTargetOSName = () => {
  if (process.argv.find(x => x.toLowerCase() === '--win32')) {
    return 'windows'
  } else if (process.argv.find(x => x.toLowerCase() === '--linux')) {
    return 'linux'
  } else {
    return 'darwin'
  }
}

const zipArchive = async (fileName, osName) => {
  const basePath = 'packages/bp'
  mkdirp.sync(`${basePath}/archives`)

  const version = fse.readJsonSync(path.resolve('package.json')).version.replace(/\./g, '_')
  const endFileName = `botpress-v${version}-${osName}-x64.zip`
  const output = fse.createWriteStream(path.resolve(`${basePath}/archives/${endFileName}`))

  const archive = archiver('zip')
  archive.pipe(output)
  archive.directory(`${basePath}/binaries/${osName}/bin`, 'bin')
  archive.file(`${basePath}/binaries/${fileName}`, { name: fileName.endsWith('.exe') ? 'bp.exe' : 'bp' })

  for (const file of glob.sync(`${basePath}/binaries/modules/*.tgz`)) {
    archive.file(file, { name: `modules/${path.basename(file)}` })
  }

  await archive.finalize()
  console.info(`${endFileName}: ${archive.pointer()} bytes`)
}

const packageAll = async () => {
  const additionalPackageJson = require(path.resolve(__dirname, './package.pkg.json'))
  const realPackageJson = require(path.resolve(__dirname, '../package.json'))
  const tempPkgPath = path.resolve(__dirname, '../packages/bp/dist/package.json')
  const cwd = path.resolve(__dirname, '../packages/bp/dist')
  const binOut = path.resolve(__dirname, '../packages/bp/binaries')

  try {
    const packageJson = Object.assign(realPackageJson, additionalPackageJson)
    await fse.writeFile(tempPkgPath, JSON.stringify(packageJson, null, 2), 'utf8')

    await execAsync(`cross-env pkg --options max_old_space_size=16384 --output ../binaries/bp ./package.json`, {
      cwd
    })

    await execAsync(`yarn bpd init --output ${path.resolve(binOut, 'win')} --platform win32 `)
    await execAsync(`yarn bpd init --output ${path.resolve(binOut, 'darwin')} --platform darwin`)
    await execAsync(`yarn bpd init --output ${path.resolve(binOut, 'linux')} --platform linux`)
  } catch (err) {
    console.error('Error running: ', err.cmd, '\nMessage: ', err.stderr, err)
  } finally {
    await fse.unlink(tempPkgPath)
  }

  await zipArchive('bp-win.exe', 'win')
  await zipArchive('bp-macos', 'darwin')
  await zipArchive('bp-linux', 'linux')
}

const packageApp = async () => {
  const additionalPackageJson = require(path.resolve(__dirname, './package.pkg.json'))
  const realPackageJson = require(path.resolve(__dirname, '../package.json'))
  const tempPkgPath = path.resolve(__dirname, '../packages/bp/dist/package.json')
  const cwd = path.resolve(__dirname, '../packages/bp/dist')
  const binOut = path.resolve(__dirname, '../packages/bp/binaries')

  try {
    const packageJson = Object.assign(realPackageJson, additionalPackageJson)
    await fse.writeFile(tempPkgPath, JSON.stringify(packageJson, null, 2), 'utf8')
    await execAsync(`yarn bpd init --output ${binOut} --platform ${getTargetOSName().replace('windows', 'win32')}`)
    await execAsync(
      `cross-env pkg --targets ${getTargetOSNodeVersion()} --options max_old_space_size=16384 --output ../binaries/bp ./package.json`,
      {
        cwd
      }
    )
  } catch (err) {
    console.error('Error running: ', err.cmd, '\nMessage: ', err.stderr, err)
  } finally {
    await fse.unlink(tempPkgPath)
  }
}

const copyNativeExtensions = async () => {
  const files = [
    ...glob.sync('./build/native-extensions/*.node'),
    ...glob.sync('./node_modules/**/node-v64-*/*.node'),
    ...glob.sync(`./build/native-extensions/${getTargetOSName()}/**/*.node`)
  ]

  mkdirp.sync('./out/binaries/bindings/')

  for (const file of files) {
    if (file.indexOf(path.join('native-extensions', getTargetOSName()).replace('\\', '/')) > 0) {
      const dist = path.basename(path.dirname(file))
      const targetDir = `./out/binaries/bindings/${getTargetOSName()}/${dist}`
      mkdirp.sync(path.resolve(targetDir))
      fs.copyFileSync(path.resolve(file), path.resolve(targetDir, path.basename(file)))
    } else {
      fs.copyFileSync(path.resolve(file), path.resolve('./out/binaries/bindings/', path.basename(file)))
    }
  }
}

const packageCore = () => {
  return gulp.series([copyNativeExtensions, packageApp])
}

const package = modules => {
  return gulp.series([
    package.packageApp,
    ...(process.argv.includes('--skip-modules') ? [] : modules),
    package.copyNativeExtensions
  ])
}

module.exports = {
  packageCore,
  packageApp,
  packageAll,
  copyNativeExtensions
}
