///////////////////////////////////////////////////////////////////////////////////
// The MIT License (MIT)
//
// Copyright (c) 2017 Tarek Sherif
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
// FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
// IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
///////////////////////////////////////////////////////////////////////////////////

"use strict";

const CONSTANTS = require("./constants");
const TEXTURE_FORMAT_DEFAULTS = require("./texture-format-defaults");

const DUMMY_ARRAY = new Array(1);

/**
    General-purpose texture.

    @class
    @prop {WebGLRenderingContext} gl The WebGL context.
    @prop {WebGLTexture} texture Handle to the texture.
    @prop {WebGLSamler} sampler Sampler object.
    @prop {GLEnum} binding Binding point for the texture.
    @prop {GLEnum} type Type of data stored in the texture.
    @prop {GLEnum} format Layout of texture data.
    @prop {GLEnum} internalFormat Internal arrangement of the texture data.
    @prop {number} currentUnit The current texture unit this texture is bound to.
    @prop {boolean} is3D Whether this texture contains 3D data.
    @prop {boolean} flipY Whether the y-axis is being flipped for this texture.
    @prop {boolean} mipmaps Whether this texture is using mipmap filtering 
        (and thus should have a complete mipmap chain).
    @prop {Object} appState Tracked GL state.
*/
class Texture {
    constructor(gl, appState, binding, image, width = image.width, height = image.height, depth, is3D, options = CONSTANTS.DUMMY_OBJECT) {
        let defaultType = options.format === CONSTANTS.DEPTH_COMPONENT ? CONSTANTS.UNSIGNED_SHORT : CONSTANTS.UNSIGNED_BYTE;

        this.gl = gl;
        this.binding = binding;
        this.texture = null;
        this.width = -1;
        this.height = -1;
        this.depth = -1;
        this.type = options.type !== undefined ? options.type : defaultType;
        this.is3D = is3D;
        this.appState = appState;

        this.format = null;
        this.internalFormat = null;
        this.compressed = !!(TEXTURE_FORMAT_DEFAULTS.COMPRESSED_TYPES[options.format] || TEXTURE_FORMAT_DEFAULTS.COMPRESSED_TYPES[options.internalFormat]);
        
        if (this.compressed) {
            // For compressed textures, just need to provide one of format, internalFormat.
            // The other will be the same.
            this.format = options.format !== undefined ? options.format : options.internalFormat;
            this.internalFormat = options.internalFormat !== undefined ? options.internalFormat : options.format;
        } else {
            this.format = options.format !== undefined ? options.format : gl.RGBA;
            this.internalFormat = options.internalFormat !== undefined ? options.internalFormat : TEXTURE_FORMAT_DEFAULTS[this.type][this.format];
        }

        // -1 indicates unbound
        this.currentUnit = -1;

        // Sampling parameters
        let {
            minFilter = image ? gl.LINEAR_MIPMAP_NEAREST : gl.NEAREST,
            magFilter = image ? gl.LINEAR : gl.NEAREST,
            wrapS = gl.REPEAT,
            wrapT = gl.REPEAT,
            wrapR = gl.REPEAT,
            compareMode = gl.NONE,
            compareFunc = gl.LEQUAL,
            minLOD = null,
            maxLOD = null,
            baseLevel = null,
            maxLevel = null,
            flipY = false
        } = options;

        this.minFilter = minFilter;
        this.magFilter = magFilter;
        this.wrapS = wrapS;
        this.wrapT = wrapT;
        this.wrapR = wrapR;
        this.compareMode = compareMode;
        this.compareFunc = compareFunc;
        this.minLOD = minLOD;
        this.maxLOD = maxLOD;
        this.baseLevel = baseLevel;
        this.maxLevel = maxLevel;
        this.flipY = flipY;
        this.mipmaps = (minFilter === gl.LINEAR_MIPMAP_NEAREST || minFilter === gl.LINEAR_MIPMAP_LINEAR);

        this.resize(width, height, depth);

        if (image) {
            this.data(image);
        }
    }

    /**
        Re-allocate texture storage.

        @method
        @param {number} width Image width.
        @param {number} height Image height.
        @param {number} [depth] Image depth or number of images. Required when passing 3D or texture array data.
        @return {Texture} The Texture object.
    */
    resize(width, height, depth) {
        depth = depth || 0;

        if (width === this.width && height === this.height && depth === this.depth) {
            return this; 
        }

        this.gl.deleteTexture(this.texture);
        if (this.currentUnit !== -1) {
            this.appState.textures[this.currentUnit] = null;
        }

        this.texture = this.gl.createTexture();
        this.bind(Math.max(this.currentUnit, 0));

        this.width = width;
        this.height = height;
        this.depth = depth;

        this.gl.texParameteri(this.binding, this.gl.TEXTURE_MIN_FILTER, this.minFilter);
        this.gl.texParameteri(this.binding, this.gl.TEXTURE_MAG_FILTER, this.magFilter);
        this.gl.texParameteri(this.binding, this.gl.TEXTURE_WRAP_S, this.wrapS);
        this.gl.texParameteri(this.binding, this.gl.TEXTURE_WRAP_T, this.wrapT);
        this.gl.texParameteri(this.binding, this.gl.TEXTURE_WRAP_R, this.wrapR);
        this.gl.texParameteri(this.binding, this.gl.TEXTURE_COMPARE_FUNC, this.compareFunc);
        this.gl.texParameteri(this.binding, this.gl.TEXTURE_COMPARE_MODE, this.compareMode);
        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, this.flipY);
        if (this.minLOD !== null) {
            this.gl.texParameterf(this.binding, this.gl.TEXTURE_MIN_LOD, this.minLOD);
        }
        if (this.maxLOD !== null) {
            this.gl.texParameterf(this.binding, this.gl.TEXTURE_MAX_LOD, this.maxLOD);
        }
        if (this.baseLevel !== null) {
            this.gl.texParameteri(this.binding, this.gl.TEXTURE_BASE_LEVEL, this.baseLevel);
        }

        if (this.maxLevel !== null) {
            this.gl.texParameteri(this.binding, this.gl.TEXTURE_MAX_LEVEL, this.maxLevel);
        }

        let levels;
        if (this.is3D) {
            if (this.mipmaps) {
                levels = Math.floor(Math.log2(Math.max(Math.max(this.width, this.height), this.depth))) + 1;
            } else {
                levels = 1;
            }
            this.gl.texStorage3D(this.binding, levels, this.internalFormat, this.width, this.height, this.depth);
        } else {
            if (this.mipmaps) {
                levels = Math.floor(Math.log2(Math.max(this.width, this.height))) + 1;
            } else {
                levels = 1;
            }
            this.gl.texStorage2D(this.binding, levels, this.internalFormat, this.width, this.height);
        }

        return this;
    }

    /**
        Set the image data for the texture. An array can be passed to manually set all levels 
        of the mipmap chain. If a single level is passed and mipmap filtering is being used,
        generateMipmap() will be called to produce the remaining levels.
        NOTE: the data must fit the currently-allocated storage!

        @method
        @param {ImageElement|ArrayBufferView|Array} data Image data. If an array is passed, it will be 
            used to set mip map levels.
        @return {Texture} The Texture object.
    */
    data(data) {
        if (!Array.isArray(data)) {
            DUMMY_ARRAY[0] = data;
            data = DUMMY_ARRAY;
        }

        let numLevels = this.mipmaps ? data.length : 1;
        let width = this.width;
        let height = this.height;
        let depth = this.depth;
        let generateMipmaps = this.mipmaps && data.length === 1;
        let i;

        this.bind(Math.max(this.currentUnit, 0));

        if (this.compressed) {
            if (this.is3D) {
                for (i = 0; i < numLevels; ++i) {
                    this.gl.compressedTexSubImage3D(this.binding, i, 0, 0, 0, width, height, depth, this.format, data[i]);
                    width = Math.max(width >> 1, 1);
                    height = Math.max(height >> 1, 1);
                    depth = Math.max(depth >> 1, 1);
                }
            } else {
                for (i = 0; i < numLevels; ++i) {
                    this.gl.compressedTexSubImage2D(this.binding, i, 0, 0, width, height, this.format, data[i]);
                    width = Math.max(width >> 1, 1);
                    height = Math.max(height >> 1, 1);
                }
            }
        } else if (this.is3D) {
            for (i = 0; i < numLevels; ++i) {
                this.gl.texSubImage3D(this.binding, i, 0, 0, 0, width, height, depth, this.format, this.type, data[i]);
                width = Math.max(width >> 1, 1);
                height = Math.max(height >> 1, 1);
                depth = Math.max(depth >> 1, 1);
            }
        } else {
            for (i = 0; i < numLevels; ++i) {
                this.gl.texSubImage2D(this.binding, i, 0, 0, width, height, this.format, this.type, data[i]);
                width = Math.max(width >> 1, 1);
                height = Math.max(height >> 1, 1);
            }
        }

        if (generateMipmaps) {
            this.gl.generateMipmap(this.binding);
        }

        return this;
    }

    /**
        Delete this texture.

        @method
        @return {Texture} The Texture object.
    */
    delete() {
        if (this.texture) {
            this.gl.deleteTexture(this.texture);
            this.texture = null;

            if (this.currentUnit !== -1 && this.appState.textures[this.currentUnit] === this) {
                this.appState.textures[this.currentUnit] = null;
                this.currentUnit = -1;
            }
        }

        return this;
    }

    /**
        Bind this texture to a texture unit.

        @method
        @ignore
        @return {Texture} The Texture object.
    */
    bind(unit) {
        let currentTexture = this.appState.textures[unit];
        
        if (currentTexture !== this) {
            if (currentTexture) {
                currentTexture.currentUnit = -1;
            }

            if (this.currentUnit !== -1) {
                this.appState.textures[this.currentUnit] = null;
            }

            this.gl.activeTexture(this.gl.TEXTURE0 + unit);
            this.gl.bindTexture(this.binding, this.texture);

            this.appState.textures[unit] = this;
            this.currentUnit = unit;
        }

        return this;
    }

}

module.exports = Texture;
