%global min_xulrunner_version 60.9.1

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
Version:    1.22.27
Release:    1
License:    MPLv2.0
URL:        https://git.sailfishos.org/mer-core/embedlite-components
Source0:    %{name}-%{version}.tar.bz2

BuildRequires:  libtool
BuildRequires:  automake
BuildRequires:  autoconf
BuildRequires:  perl
Requires:  xulrunner-qt5 >= %{min_xulrunner_version}
Conflicts: embedlite-components

%description
EmbedLite Components required for embeded browser UI

%prep
%setup -q -n %{name}-%{version}

%build

NO_CONFIGURE=yes ./autogen.sh
%configure

make %{?_smp_mflags}

%install
rm -rf %{buildroot}
%make_install

%post
/sbin/ldconfig
touch /var/lib/_MOZEMBED_CACHE_CLEAN_

%postun
/sbin/ldconfig

%files
%defattr(-,root,root,-)
%license COPYING
%{_libdir}/mozembedlite
