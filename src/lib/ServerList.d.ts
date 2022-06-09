export type ServerList = {
    trusted: ({ name: string, address: string })[],
    untrusted: string[]
}

type TrustedServer = {
    name: string,
    address: string
}