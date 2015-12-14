Name:       embedlite-components
Summary:    EmbedLite components
Version:    1.0.0
Release:    1
Group:      Applications/Internet
License:    MPLv2
URL:        https://github.com/tmeshkova/embedlite-components
Source0:    %{name}-%{version}.tar.bz2
BuildRequires:  xulrunner-devel
BuildRequires:  pkgconfig(nspr)
BuildRequires:  python
BuildRequires:  libtool
BuildRequires:  automake
BuildRequires:  autoconf
BuildRequires:  perl
Requires:  xulrunner

%description
EmbedLite Components required for embeded browser UI

%prep
%setup -q -n %{name}-%{version}

%build

NO_CONFIGURE=yes ./autogen.sh
%configure --with-system-nspr

make %{?jobs:-j%jobs}

%install
rm -rf %{buildroot}
%make_install

%post
/sbin/ldconfig

%postun
/sbin/ldconfig

%files
%defattr(-,root,root,-)
%{_libdir}/mozembedlite/*
