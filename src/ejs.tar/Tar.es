/**
    Tar.es -- Tar archive management
 */


# Config.TAR
module ejs.tar {

    require ejs.zlib

    const BlockSize = 512

    /*
        Operations
     */
    const Extract: Number = 1
    const Info: Number = 2
    const List: Number = 3
    const Read: Number = 4

    /*
        Types
     */
    const Regular: Number = 0
    const HardLink: Number = 1
    const SymLink: Number = 2
    const CharSpecial: Number = 3
    const BlockSpecial: Number = 4
    const Directory: Number = 5
    const Fifo: Number = 6

    class Tar {
        private var path: Path
        private var options: Object

        use default namespace public

        /*
            Create a new Tar object
            @param path Pathname to the tar archive
            @param options Configurable options
            @option chdir Directory to change to before executing the desired operation. In create mode,
                the archive is created, then the directory is changed before adding files. In extract mode,
                the archive is opened, then the directory is changed before extracting files.
            @option dest Destination directory to use for extracting.
            @option relativeTo Path Base filenames relative to this directory when creating archives 
            @option group Group name to use instead of the file group name
            @option uid User id to use instead of the file user id
            @option gid Group id to use instead of the file group id
            @option user User name to use instead of the file user name
            @option trim Number of filename segments to trim from the start of the filename when extracting.
         */
        function Tar(path: Path, options: Object = {}) {
            this.path = path
            this.options = options
        }

        function get name(): Path
            this.path

        private function flatten(args: Array): Array {
            let files = []
            for each (file in args) {
                if (file is Array) {
                    files += file
                } else {
                    files.push(file)
                }
            }
            for (i in files) {
                files[i] = Path(files[i])
            }
            return files
        }

        function create(...args): Void {
            var archive: File  = File(path, {mode: 'w', permissions: 0644})
            let home = App.dir
            try {
                if (options.chdir) {
                    App.chdir(options.chdir)
                }
                for each (file in flatten(args)) {
                    if (!file.exists) {
                        throw 'File does not exist: ' + file
                    }
                    let header = new TarHeader(options)
                    header.createHeader(file)
                    header.write(archive)
                    if (header.type == Regular) {
                        let fp = File(file, 'r')
                        let data = new ByteArray
                        while (fp.read(data)) {
                            archive.write(data)
                        }
                        data.flush()
                        let remainder = 512 - (file.size % 512)
                        if (remainder < 512) {
                            data.writePosition = remainder
                            archive.write(data)
                        }
                        fp.close()
                    }
                }
            } finally {
                App.chdir(home)
            }
            archive.close()

            if (path.extension == 'tgz' || path.extension == 'gz') {
                let plain = path.joinExt('plain', true)
                path.rename(plain)
                Zlib.compress(plain, path)
                plain.remove()
            } else if (options.compress) {
                let plain = path.joinExt('plain', true)
                path.rename(plain)
                Zlib.compress(plain, path)
                plain.remove()
            }
        }

        function operate(files: Array, operation) {
            let uncompressed = path
            if (path.extension == 'tgz') {
                uncompressed = path.replaceExt('tar')
                Zlib.uncompress(path, uncompressed)
            } else if (path.extension == 'gz') {
                uncompressed = path.trimExt('gz')
                Zlib.uncompress(path, uncompressed)
            } else if (options.uncompress) {
                uncompressed = Path().temp()
                Zlib.uncompress(path, uncompressed)
            }
            let home = App.dir
            let result = []
            let archive = File(uncompressed, 'r')

            try {
                if (options.chdir) {
                    App.chdir(options.chdir)
                }
                let data: ByteArray?
                let links = {}
                while ((data = archive.readBytes(BlockSize)) != null) {
                    if (data[0] == 0) {
                        /* EOF is two null blocks - just test for one */
                        let eof = true
                        for (i in BlockSize) {
                            if (data[i] != 0) {
                                eof = false
                            }
                        }
                        if (eof) {
                            break
                        }
                    }
                    let header = new TarHeader(options)
                    header.parse(data)
                    let filename = header.path
                    if (options.trim) {
                        filename = filename.components.slice(options.trim).join(filename.separator)
                    }
                    if (options.dest) {
                        filename = Path(options.dest).join(filename)
                    }
                    if (files.contains(filename) || files.length == 0) {
                        if (operation == Extract) {
                            filename.dirname.makeDir()
                            if (header.type == HardLink) {
                                if (Config.OS == 'windows') {
                                    links[header.linkName] = header.name
                                } else {
                                    Path(header.linkName).link(header.name, true)
                                }
                            } else if (header.type == SymLink) {
                                if (Config.OS == 'windows') {
                                    links[header.linkName] = header.name
                                } else {
                                    Path(header.linkName).link(header.name)
                                }
                            } else if (header.type == Directory) {
                                filename.makeDir()
                                archive.position += header.size
                            } else if (isNaN(header.type)) {
                                /* Skip Pax global header */
                                archive.position += header.size
                            } else {
                                let fp = new File(filename, 'w')
                                let len = header.size
                                let buf = new ByteArray(32 * 1024)
                                while (len > 0) {
                                    buf.flush()
                                    count = len.min(buf.size)
                                    bytes = archive.read(buf, 0, count)
                                    fp.write(buf)
                                    len -= count
                                }
                                fp.close()
                            }
                            try {
                                if (App.uid == 0) {
                                    filename.setAttributes(header.attributes)
                                } else {
                                    filename.setAttributes({permissions: header.mode})
                                }
                            } catch {}

                        } else if (operation == Info) {
                            result.push({
                                path: header.path,
                                mode: header.mode,
                                uid: header.uid,
                                gid: header.gid,
                                size: header.size,
                                modified: header.modified,
                                user: header.user,
                                group: header.group,
                                type: header.type,
                            })
                            archive.position += header.size

                        } else if (operation == List) {
                            result.push(header.path)
                            archive.position += header.size

                        } else if (operation == Read) {
                            let result = new ByteArray(header.size)
                            archive.read(result, 0, header.size)
                            return result
                        }
                    } else {
                        archive.position += header.size
                    }
                    let remainder = 512 - (header.size % 512)
                    if (remainder < 512) {
                        archive.position += remainder;
                    }
                }
                if (operation == Extract) {
                    for (let [target, filename] in links) {
                        Path(filename).dirname.join(target).copy(filename)
                    }
                }
            } finally {
                archive.close()
                App.chdir(home)
                if (uncompressed != path) {
                    uncompressed.remove()
                }
            }
            return result
        }

        function extract(...args): Void
            operate(flatten(args), Extract)

        function info(...args): Array
            operate(flatten(args), Info)

        function list(...args): Array
            operate(flatten(args), List)

        function read(...args): ByteArray
            operate(flatten(args), Read)

        function readString(...args): String
            operate(flatten(args), Read)
    }

    internal enumerable class TarHeader {
        var name: String            /* File name. Up to 100 characters. Null terminated if room */
        var mode: Number            /* File permission (octal) */
        var uid: Number             /* User ID (octal) */
        var gid: Number             /* (octal) */
        var size: Number            /* File size (octal) */
        var modified: Date          /* Last modified time in Seconds since Jan 1 1970 (octal) */
        var type: Number            /* Type flag */
        var linkName: String        /* Link target name. Up to 100 characters. Null terminate if room */
        var magic: String           /* Set to 'ustar' null terminated */
        var user: String?           /* User name. Up to 32 chars, null terminated */
        var group: String?          /* Group name. Up to 32 chars, null terminated */
        var major: Number           /* Device major (octal) */
        var magic: String           /* Magic string */
        var minor: Number           /* Device minor (octal) */
        var prefix: String          /* Prefix to file name. Null-terminated if room */
        var sum: Number             /* Header checksum */
        var version: String         /* Version string */
        var options: Object         /* Tar object options */

        function TarHeader(options) {
            this.options = options
        }

        /*
            Create a new header entry
         */
        function createHeader(path: Path) {
            let attributes = path.attributes
            mode = attributes.permissions
            uid = options.uid || attributes.uid
            gid = options.gid || attributes.gid
            user = options.user || attributes.user
            group = options.group || attributes.group
            size = path.size
            modified = path.modified
            link = path.isLink
            if (link) {
                type = SymLink
                linkName = path.linkTarget
                mode = path.dirname.attributes.permissions
                modified = path.dirname.modified
                size = 0
            } else {
                type = Regular
            }
            if (options.relativeTo) {
                path = path.relativeTo(options.relativeTo)
            }
            if (path.length > 100) {
                name = path.basename.portable
                prefix = path.dirname.portable
                if (name.length > 100 || prefix.length > 155) {
                    throw 'Path name ' + path + ' is too long'
                }
            } else {
                name = path.portable
            }
        }

        function parse(header: ByteArray) {
            let csum = checksum(header)
            name = parseStr(header, 100)
            mode = parseNum(header, 8)
            uid = parseNum(header, 8)
            gid = parseNum(header, 8)
            size = parseNum(header, 12)
            modified = Date(parseNum(header, 12) * 1000)
            sum = parseNum(header, 8)
            type = parseNum(header, 1)
            linkName = parseStr(header, 100)
            magic = parseStr(header, 6)
            version = parseStr(header, 2)
            user = parseStr(header, 32)
            group = parseStr(header, 32)
            major = parseNum(header, 8)
            minor = parseNum(header, 8)
            prefix = parseStr(header, 155)
            if (sum != csum) {
                throw 'Bad file format. Checksum mismatch: ' + sum + ' ' + csum
            }
        }

        function get attributes() {
            let att = {}
            if (uid) att.uid = uid
            if (gid) att.gid = gid
            if (user) att.user = user
            if (group) att.group = group
            return att
        }

        function get path(): Path {
            return Path((prefix) ? (Path(prefix).join(name)) : name)
        }

        function show(ba) {
            for (i = 0; i < ba.length; i += 16) {
                stdout.write(['%07o    ' % [i]])
                for (j in 16) {
                    stdout.write(['%02X  ' % ba[i+j]])
                }
                stdout.write('\n')
            }
        }

        /*
            See: 
                http://www.subspacefield.org/~vax/tar_format.html
                http://www.fileformat.info/format/tar/corion.htm
         */
        function write(fp: File) {
            let ba = new ByteArray
            ba.write(name)
            ba.writePosition = 100
            ba.write('%06o ' % [mode]) ; ba.writePosition++
            ba.write('%06o ' % [uid]) ; ba.writePosition++
            ba.write('%06o ' % [gid]) ; ba.writePosition++
            ba.write('%011o ' % [size])
            ba.write('%011o ' % [modified.time / 1000])
            ba.writePosition = 156
            ba.write('%1d' % [type])
            if (linkName) {
                ba.write(linkName) ; ba.writePosition += linkName.length
                ba.writeByte(0)
            }
            ba.writePosition = 257
            ba.write('ustar')
            ba.writePosition = 263
            ba.write('00')
            ba.writePosition = 265
            ba.write('%s' % [user])
            ba.writePosition = 297
            ba.write('%s' % [group])
            if (prefix) {
                ba.writePosition = 345
                ba.write(prefix)
            }
            ba.writePosition = 512
            /* 
                The checksum is stored as as 6 octal digits followed by a null + space 
             */
            let csum = checksum(ba)
            ba.writePosition = 148
            ba.write('%06o' % [csum])
            ba.writePosition++
            ba.write(' ')
            ba.writePosition = 512
            fp.write(ba)
        }

        /*
            Calculate a checksum of the 512-byte header
         */
        private function checksum(data: ByteArray): Number {
            let total = 0
            for (i = 0; i < 512; i++) {
                if (i == 148) {
                    /* Skip the checksum field */
                    total += ' '.charCodeAt() * 8
                    i += 7
                } else {
                    total += data[i]
                }
            }
            return total
        }

        private function parseStr(data: ByteArray, count: Number): String {
            let i, j
            for (i = 0, j = data.readPosition; i < count; i++, j++) {
                if (data[j] == 0) {
                    break
                }
            }
            let s = data.readString(i)
            data.readPosition += count - i
            return s
        }

        private function parseNum(data: ByteArray, count: Number) {
            field = data.readString(count)
            return parseInt(field, 8)
        }
    }

}

/*
    @copy   default

    Copyright (c) Embedthis Software. All Rights Reserved.

    This software is distributed under commercial and open source licenses.
    You may use the Embedthis Open Source license or you may acquire a 
    commercial license from Embedthis Software. You agree to be fully bound
    by the terms of either license. Consult the LICENSE.md distributed with
    this software for full details and other copyrights.

    Local variables:
    tab-width: 4
    c-basic-offset: 4
    End:
    vim: sw=4 ts=4 expandtab

    @end
 */
