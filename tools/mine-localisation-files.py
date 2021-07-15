#!/usr/bin/env python3
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright (c) 2021 Open Mobile Platform LLC.
#
# Given a locale abbreviation and date, searches the mozilla l10n
# repositories for the appropriate error localisation files
# (.dtd and .property files), transforms them and saves them in
# the approprite place in the project hierarchy.
#
# The following must be manually updated for any new
# locales added.
#
#   1. embedlite-components.pro
#   2. overrides/EmbedLiteOverrides.manifest
#   3. overrides/Makefile.am
#   4. jsscripts/embedhelper.js
#
# Requires: mercurial and git to be installed.
#

import argparse, datetime, subprocess, os, shutil, re, textwrap

DEFAULT_DATE = '2019-10-21'

def get_git_root():
    try:
        url = subprocess.check_output(['git', 'config', '--get', 'remote.origin.url'], stderr=subprocess.DEVNULL, encoding='ascii').strip()
        root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], stderr=subprocess.DEVNULL, encoding='ascii').strip()
    except:
        print('Not a git repository')
        return ''

    if not re.fullmatch(r'git@github.com\:.*\/embedlite-components\.git', url):
        print('Repository URL: {}'.format(url))

    return root

def convert_firefox_to_browser(filename):
    content = ''
    # Read the file contents
    with open(filename, 'r') as file:
        content = file.read()
        content = re.sub(r'Firefox', 'Browser', content)
    # Write out the new file contents
    if content:
        with open(filename, 'w') as file:
            file.write(content)

def get_path(filename, expected):
    if os.path.isfile(expected + '/' + filename):
        return expected + '/' + filename
    possibilities = subprocess.check_output(['find', '.', '-iname', filename], encoding='ascii').split()
    if len(possibilities) == 0:
        # Nothing found
        return ''

    # The checks and their weightings
    checks = []
    # Check subfolders
    checks.append((50, (lambda path : possibility.startswith(expected))))
    # Check if path contains 'mobile'
    checks.append((40, (lambda path : possibility.find('mobile') >= 0)))
    # Check if path contains 'browser'
    checks.append((30, (lambda path : possibility.find('browser') >= 0)))
    # Check if path contains 'dom'
    checks.append((20, (lambda path : possibility.find('dom') >= 0)))
    # Check if path is non-empty
    checks.append((10, (lambda path : len(path) > 0)))

    # Find the best option based on the check weightings
    best = ''
    weight = 0
    for possibility in possibilities:
        for check in checks:
            if check[0] > weight and check[1](possibility):
                best = possibility
                weight = check[0]

    if not best:
        # Just return the first one in the list
        best = possibilities[0]

    return best

def convert_file(filename, expected, destination):
    print('Copying and converting file: {}'.format(filename))

    path = get_path(filename, expected)
    print('Found version at: {}'.format(path))
    if path:
        final_path = destination + '/' + filename
        print('Copying file to: {}'.format(final_path))
        shutil.copyfile(path, final_path)
        convert_firefox_to_browser(final_path)

def mine_locale(locale, date):
    repo_local = '/tmp/l10n-repo'
    repo_remote = 'https://hg.mozilla.org/l10n-central/' + locale
    retcode = 0
    cloned = False

    # Perform checks
    git_root = get_git_root()
    if not git_root:
        print('You must execute this inside the embedlite-components git tree')
        retcode = 128

    if retcode == 0:
        print('Git root: {}'.format(git_root))

        cwd_orig = os.getcwd()

        #os.chdir('/tmp')

        # Clone the repository
        print('Cloning repository {} to {}'.format(repo_remote, repo_local))
        retcode = subprocess.call(['hg', 'clone', repo_remote, repo_local, '-U'])
        if retcode == 0:
            print('Successfully cloned')
            cloned = True
        else:
            print('Error cloning')

    if retcode == 0:
        os.chdir(repo_local)

        # Search for the appropriate commit
        print('Searching for an appropriate commit')
        checkdate = date
        revision = ''
        while revision == '':
            datestring = date.isoformat()
            revision = subprocess.check_output(['hg', 'log', '--date', datestring, '--limit', '1', '--template', '"{node}"'], encoding='ascii').strip()
            date += datetime.timedelta(days=-1)
        print("Found revision {} on {}".format(revision, datestring))

        # Update to the revision
        print('Checking out revision {}'.format(revision))
        retcode = subprocess.call(['hg', 'update', '--rev', revision])
        if retcode == 0:
            print('Revision Successfully set')
        else:
            print('Error updating to revision')

    if retcode == 0:
        folder = git_root + '/overrides/' + locale
        try:
            os.mkdir(folder)
        except:
            # Just skip it if it already exists
            pass

        # Search for the right files
        # Copy the files
        # Transform the files

        print('Duplicating non-localised files')

        # overrides/en-US/brand.dtd
        shutil.copyfile(git_root + '/overrides/en-US/brand.dtd', folder + '/brand.dtd')

        # overrides/en-US/brand.properties
        shutil.copyfile(git_root + '/overrides/en-US/brand.properties', folder + '/brand.properties')

        # ./mobile/overrides/appstrings.properties
        convert_file('appstrings.properties', './mobile/overrides', folder)

        # ./mobile/overrides/netError.dtd
        convert_file('netError.dtd', './mobile/overrides', folder)

        # ./mobile/android/chrome/aboutCertError.dtd
        convert_file('aboutCertError.dtd', './mobile/android/chrome', folder)

    # Clean up
    if cloned:
        print('Removing temporary repository: {}'.format(repo_local))
        shutil.rmtree(repo_local)

    print()
    if retcode == 0:
        print('Completed successfully')
    else:
        print('Completed with errors')

    return retcode

# See https://stackoverflow.com/questions/377017/test-if-executable-exists-in-python
def exe_exists(name):
    for path in os.environ["PATH"].split(os.pathsep):
        exe = os.path.join(path, name)
        if os.path.isfile(exe) and os.access(exe, os.X_OK):
            return True
    return False

def requirements_met():
    if not exe_exists('git'):
        print('git must be installed for this script to work')
        return False
    if not exe_exists('hg'):
        print('mercurial (hg) must be installed for this script to work')
        return False
    return True

def main():
    parser = argparse.ArgumentParser(formatter_class=argparse.RawDescriptionHelpFormatter,
    description=textwrap.dedent('''
    A utility for extracting localisation files from the mozilla mercurial l10n-central
    repositories and installing them into the embedlite-components overrides tree.
    '''),
    epilog=textwrap.dedent('''
    This must be executed from inside the embedlite-components git tree so that it
    can find where to install the files.

    Once the files for a locale have been installed in embedlite-components, the
    following must be updated to point to them:
        1. embedlite-components.pro
        2. overrides/EmbedLiteOverrides.manifest
        3. overrides/Makefile.am
        4. jsscripts/embedhelper.js
    '''))
    parser.add_argument("locale", metavar="LOCALE", help="Locale abbreviation (e.g. en-US, fi, ru")
    parser.add_argument("--date", default=DEFAULT_DATE, type=lambda s: datetime.datetime.strptime(s, "%Y-%m-%d").date(), help=f"Date of latest commit to support (YYYY-MM-DD)")
    args = parser.parse_args()
    print('Selected locale: {}'.format(args.locale))
    print('Latest release date: {}'.format(args.date))
    print()
    if requirements_met():
        mine_locale(args.locale, args.date)

if __name__ == "__main__":
    main()
