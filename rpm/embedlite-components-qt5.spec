# Don't depend on private xulrunner-qt5 libraries.
%global privlibs             libfreebl3
%global privlibs %{privlibs}|libmozalloc
%global privlibs %{privlibs}|libmozsqlite3
%global privlibs %{privlibs}|libnspr4
%global privlibs %{privlibs}|libnss3
%global privlibs %{privlibs}|libnssdbm3
%global privlibs %{privlibs}|libnssutil3
%global privlibs %{privlibs}|libplc4
%global privlibs %{privlibs}|libplds4
%global privlibs %{privlibs}|libsmime3
%global privlibs %{privlibs}|libsoftokn3
%global privlibs %{privlibs}|libssl3

%global __requires_exclude ^(%{privlibs})\\.so

Name:       embedlite-components-qt5
Summary:    EmbedLite components Qt5
Version:    1.9.0
Release:    1
Group:      Applications/Internet
License:    Mozilla License
URL:        https://github.com/tmeshkova/embedlite-components
Source0:    %{name}-%{version}.tar.bz2
Patch0:     0001-Tweak-UA-for-Facebook-and-Engadget-to-get-images-of-.patch
Patch1:     0002-Tweak-UA-for-Dailymotion-to-get-working-fullscreen-b.patch
BuildRequires:  xulrunner-qt5-devel >= 38.0.5
BuildRequires:  pkgconfig(nspr)
BuildRequires:  python
BuildRequires:  libtool
BuildRequires:  automake
BuildRequires:  autoconf
BuildRequires:  perl
Requires:  xulrunner-qt5 >= 31.7.0.14
Conflicts: embedlite-components

%description
EmbedLite Components required for embeded browser UI

%prep
%setup -q -n %{name}-%{version}

# >> setup
%patch0 -p1
%patch1 -p1
# << setup

%build
# >> build pre
# << build pre

NO_CONFIGURE=yes ./autogen.sh
%configure --with-system-nspr

make %{?jobs:-j%jobs}

# >> build post
# << build post

%install
rm -rf %{buildroot}
# >> install pre
# << install pre
%make_install

# >> install post
# << install post

%post
# >> post
/sbin/ldconfig
touch /var/lib/_MOZEMBED_CACHE_CLEAN_
# << post

%postun
# >> postun
/sbin/ldconfig
# << postun

%files
%defattr(-,root,root,-)
# >> files
%{_libdir}/mozembedlite/*
%exclude %{_libdir}/mozembedlite/chrome/embedlite/content/duckduckgo.xml
%exclude %{_libdir}/mozembedlite/chrome/embedlite/content/baidu.xml
# << files
