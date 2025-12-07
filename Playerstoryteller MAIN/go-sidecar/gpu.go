package main

import (
	"strings"

	"github.com/yusufpapurcu/wmi"
)

type Win32_VideoController struct {
	Name string
}

type GPUVendor string

const (
	VendorNvidia  GPUVendor = "NVIDIA"
	VendorAMD     GPUVendor = "AMD"
	VendorIntel   GPUVendor = "INTEL"
	VendorUnknown GPUVendor = "UNKNOWN"
)

// GetGPUVendor detects the primary GPU vendor using WMI
func GetGPUVendor() GPUVendor {
	var dst []Win32_VideoController
	query := wmi.CreateQuery(&dst, "")
	err := wmi.Query(query, &dst)
	if err != nil {
		return VendorUnknown
	}

	for _, v := range dst {
		name := strings.ToUpper(v.Name)
		if strings.Contains(name, "NVIDIA") {
			return VendorNvidia
		}
		if strings.Contains(name, "AMD") || strings.Contains(name, "RADEON") {
			return VendorAMD
		}
		if strings.Contains(name, "INTEL") {
			// Keep looking in case there's a discrete GPU (e.g. laptop with Intel iGPU + Nvidia dGPU)
			// But if we found nothing else yet, mark as Intel
			continue
		}
	}

	// Second pass: if we found an Intel card but no discrete card, return Intel
	for _, v := range dst {
		name := strings.ToUpper(v.Name)
		if strings.Contains(name, "INTEL") {
			return VendorIntel
		}
	}

	return VendorUnknown
}
