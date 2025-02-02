require('dotenv-defaults').config()
const semver = require('semver')
const axios = require('axios')
const fetch = require('node-fetch')

const CustomError = require('../server/CustomError')

async function resolveFromAlgolia({ name, version, scoped }) {
  let results
  try {
    const response =
      await axios.get(`https://${process.env.ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/npm-search/${encodeURIComponent(name)}`, {
        params: {
          'x-algolia-agent': 'bundlephobia',
          'x-algolia-application-id': process.env.ALGOLIA_APP_ID,
          'x-algolia-api-key': process.env.ALGOLIA_API_KEY,
        },
      })

    results = response.data
  } catch (err) {
    let details = err

    if (err) {
      if (err.response) {
        details = err.response.data
      } else if(err.request) {
        details = err.request._currentUrl
      }
    }
    throw new CustomError('PackageNotFoundError', { name, version, details })
  }


  if (results.tags) {
    results.tags = {
      latest: results.version,
      ...results.tags,
    }
  } else {
    results.tags = {
      latest: results.version,
    }
  }
  results.versions = results.versions || {}

  if (version in results.tags) {
    return { ...results, scoped, version: results.tags[version] }
  }

  if (version in results.versions) {
    return { ...results, scoped, version }
  }

  const [major, minor, patch] = version.split('.')

  // Find the closest valid match (if exists)
  const matches = Object.keys(results.versions)
    .filter((resultVersion) => {
      const parsedSemver = semver(resultVersion)
      if (!minor) {
        return major == parsedSemver.major
      }

      if (minor && !patch) {
        return major == parsedSemver.major && minor == parsedSemver.minor
      }

      return false
    })
    .filter(v => !v.includes('-'))

  if (!matches.length) {
    throw new CustomError('PackageVersionMismatchError', null, {
      validVersions: Object.keys(results.tags)
        .concat(Object.keys(results.versions)),
    })
  } else {
    return { ...results, version: matches[0], scoped }
  }
}

async function resolveFromYarn({ scoped, name, version }) {
  try {
    // Version info of scoped packages cannot be
    // fetched directly, hence we must fetch data
    // for all versions, which is expensive :(
    // @see https://github.com/npm/registry/issues/34
    if (scoped) {
      const [scopePart, namePart] = name.split('/')
      const response = await axios.get(`https://registry.yarnpkg.com/${scopePart}${encodeURIComponent('/')}${namePart}`)
      const packageInfo = await response.json()

      if (!response.ok || !packageInfo['dist-tags'] || !packageInfo['dist-tags'][version]) {
        throw new CustomError('PackageNotFoundError', { statusText: response.statusText })
      }

      return { ...packageInfo, scoped, name, version: packageInfo['dist-tags'][version] }

    } else {
      const response = await fetch(`https://registry.yarnpkg.com/${name}/${version}`)

      if (!response.ok) {
        throw new CustomError('PackageNotFoundError', { statusText: response.statusText })
      }

      const packageInfo = await response.json()
      return { ...packageInfo, scoped }
    }
  } catch (err) {
    throw new CustomError('PackageNotFoundError', err)
  }
}

/**
 * Given a package name and optionally a version
 * this function resolves to a valid version and name.
 */
async function resolvePackage({ scoped, name, version }) {

  const tempVersion = version || 'latest'
  if (process.env.ALGOLIA_APP_ID && process.env.ALGOLIA_API_KEY) {
    return await resolveFromAlgolia({ scoped, name, version: tempVersion })
  } else {
    return await resolveFromYarn({ scoped, name, version: tempVersion })
  }
}

module.exports = { resolvePackage }
